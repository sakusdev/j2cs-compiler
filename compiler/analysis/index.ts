import { fail } from '../diagnostics/index.js';
import type { Expr, Node, Program, Statement } from '../parser/ast.js';
import type { SemanticExpr as SE, SemanticForInitializer, SemanticFunction, SemanticProgram, SemanticStatement as SS } from '../ir/semantic.js';
import { type Binding, type Bindings } from './bindings.js';
import { exactly, literalType, union, type TypeSet } from './facts.js';
type Environment = Map<number, TypeSet>;
interface Flow { env: Environment; reachable: boolean; returns: TypeSet[] }
interface LoopControl { breaks: Environment[]; continues: Environment[] }
const MAX_LOOP_FIXPOINT = 16;
export function analyze(program: Program, bindings: Bindings): SemanticProgram {
  const instances: SemanticFunction[] = [], cache = new Map<string, SemanticFunction>(), active = new Set<number>();
  let nextInstance = 0;
  const syntheticUndefined = (n: Node): SE => ({ ...n, kind: 'literal', value: undefined, types: ['Undefined'] });
  const copyEnv = (env: Environment): Environment => new Map(env);
  function joinPaths(template: Environment, paths: Environment[]): Environment {
    const result = new Map<number, TypeSet>();
    for (const id of template.keys()) {
      const values = paths.map(p => p.get(id)).filter((x): x is TypeSet => x !== undefined);
      if (values.length) result.set(id, union(...values));
    }
    return result;
  }
  function widen(base: Environment, paths: Environment[]): Environment { return joinPaths(base, [base, ...paths]); }
  function sameEnv(a: Environment, b: Environment): boolean {
    if (a.size !== b.size) return false;
    for (const [id, types] of a) {
      const other = b.get(id);
      if (!other || types.length !== other.length || types.some((t, i) => t !== other[i])) return false;
    }
    return true;
  }
  function emptyStatement(n: Statement): SS { return { ...n, kind: 'block', body: [] }; }
  function readType(b: Binding, n: Node, f: Flow): TypeSet {
    if (b.kind === 'intrinsic') return b.name === 'undefined' ? ['Undefined'] : ['Number'];
    const types = f.env.get(b.id);
    if (!types) fail('E_TDZ', `Binding '${b.name}' is accessed before initialization.`, n.span);
    return types;
  }
  function addTypes(left: TypeSet, right: TypeSet): TypeSet {
    if (exactly(left, 'String') || exactly(right, 'String')) return ['String'];
    return left.includes('String') || right.includes('String') ? ['Number', 'String'] : ['Number'];
  }
  function instantiate(b: Binding, args: SE[], call: Node): SemanticFunction {
    const fn = b.function!;
    if (args.length !== fn.params.length) fail('E_ARITY', 'Only exact-arity direct function calls are supported.', call.span);
    if (active.has(b.id)) fail('E_RECURSION', 'Recursive call graphs require a summary fixed point; unsupported in this MVP.', call.span);
    const key = `${b.id}:${args.map(a => a.types.join('|')).join(',')}`;
    const found = cache.get(key); if (found) return found;
    active.add(b.id);
    const instanceId = nextInstance++, params = fn.params.map(p => bindings.declarations.get(p.id)!);
    const f: Flow = { env: new Map(params.map((p, i) => [p.id, args[i]!.types])), reachable: true, returns: [] };
    const body = statements(fn.body.body, f);
    if (f.reachable) {
      const value = syntheticUndefined(fn.body);
      body.push({ ...fn.body, kind: 'return', value }); f.returns.push(value.types);
    }
    const instance: SemanticFunction = { ...fn, instanceId, binding: b, params, body, returnTypes: union(...f.returns) };
    instances.push(instance); cache.set(key, instance); active.delete(b.id); return instance;
  }
  function expression(n: Expr, f: Flow): SE {
    switch (n.kind) {
      case 'literal': return { ...n, types: literalType(n.value) };
      case 'identifier': {
        const binding = bindings.references.get(n.id)!;
        return { ...n, kind: 'read', binding, types: readType(binding, n, f) };
      }
      case 'binary': {
        const left = expression(n.left, f), right = expression(n.right, f);
        let types: TypeSet;
        if (['<', '<=', '>', '>=', '===', '!=='].includes(n.op)) types = ['Boolean'];
        else if (n.op === '+') types = addTypes(left.types, right.types);
        else types = ['Number'];
        return { ...n, left, right, types };
      }
      case 'unary': return { ...n, operand: expression(n.operand, f), types: [n.op === '!' ? 'Boolean' : 'Number'] };
      case 'assign': {
        const binding = bindings.references.get(n.target.id)!;
        readType(binding, n.target, f);
        const value = expression(n.value, f); f.env.set(binding.id, value.types);
        return { ...n, binding, value, types: value.types };
      }
      case 'compound': {
        const binding = bindings.references.get(n.target.id)!;
        const leftTypes = readType(binding, n.target, f);
        const value = expression(n.value, f);
        const types = n.op === '+=' ? addTypes(leftTypes, value.types) : ['Number'] as TypeSet;
        f.env.set(binding.id, types);
        return { ...n, binding, leftTypes, value, types };
      }
      case 'update': {
        const binding = bindings.references.get(n.target.id)!;
        const operandTypes = readType(binding, n.target, f), types: TypeSet = ['Number'];
        f.env.set(binding.id, types);
        return { ...n, binding, operandTypes, types };
      }
      case 'member': return fail('E_MEMBER', 'Member values are unsupported.', n.span);
      case 'call': {
        if (n.callee.kind === 'member') {
          const receiver = n.callee.object;
          const binding = bindings.references.get(receiver.id)!;
          if (binding?.kind !== 'intrinsic' || binding.name !== 'console')
            fail('E_INTRINSIC_SHADOWED', 'console.log does not resolve to the pristine Node console intrinsic.', n.span);
          const args = n.args.map(a => expression(a, f));
          if (args.length > 1 && args[0]!.types.includes('String')) {
            const first = args[0]!;
            if (first.kind !== 'literal' || typeof first.value !== 'string' || first.value.includes('%'))
              fail('E_CONSOLE_FORMAT', 'Multi-argument console.log with a possible format string needs Node util.format support.', n.span);
          }
          return { ...n, kind: 'call', target: 'console', binding, args, arity: args.length, types: ['Undefined'] };
        }
        if (n.callee.kind !== 'identifier') fail('E_INDIRECT_CALL', 'Only statically resolved direct calls are supported.', n.span);
        const binding = bindings.references.get(n.callee.id)!;
        if (binding.kind !== 'function') fail('E_INDIRECT_CALL', `Calling '${binding.name}' requires callable runtime support.`, n.span);
        const args = n.args.map(a => expression(a, f)), instance = instantiate(binding, args, n);
        return { ...n, kind: 'call', binding, target: instance.instanceId, args, arity: instance.params.length, types: instance.returnTypes };
      }
    }
  }
  function statements(nodes: Statement[], f: Flow, loop?: LoopControl): SS[] {
    const result: SS[] = [];
    for (const n of nodes) {
      if (!f.reachable) break;
      const item = statement(n, f, loop); if (item) result.push(item);
    }
    return result;
  }
  function statement(n: Statement, f: Flow, loop?: LoopControl): SS | undefined {
    switch (n.kind) {
      case 'empty': case 'function': return;
      case 'variable': {
        const binding = bindings.declarations.get(n.id)!;
        const initializer = n.initializer ? expression(n.initializer, f) : syntheticUndefined(n);
        f.env.set(binding.id, initializer.types); return { ...n, binding, initializer };
      }
      case 'expression': return { ...n, expression: expression(n.expression, f) };
      case 'block': return { ...n, body: statements(n.body, f, loop) };
      case 'return': {
        const value = n.value ? expression(n.value, f) : syntheticUndefined(n);
        f.returns.push(value.types); f.reachable = false; return { ...n, value };
      }
      case 'break': {
        if (!loop) return fail('E_BREAK_CONTEXT', 'break outside a loop is unsupported.', n.span);
        loop.breaks.push(copyEnv(f.env)); f.reachable = false; return { ...n, kind: 'break' };
      }
      case 'continue': {
        if (!loop) return fail('E_CONTINUE_CONTEXT', 'continue outside a loop is unsupported.', n.span);
        loop.continues.push(copyEnv(f.env)); f.reachable = false; return { ...n, kind: 'continue' };
      }
      case 'if': {
        const condition = expression(n.condition, f);
        const a: Flow = { env: copyEnv(f.env), reachable: true, returns: [] };
        const b: Flow = { env: copyEnv(f.env), reachable: true, returns: [] };
        const then = statement(n.then, a, loop) ?? emptyStatement(n.then);
        const otherwise = n.otherwise && (statement(n.otherwise, b, loop) ?? emptyStatement(n.otherwise));
        const live = [a, b].filter(x => x.reachable).map(x => x.env);
        if (live.length) f.env = joinPaths(f.env, live);
        f.returns.push(...a.returns, ...b.returns); f.reachable = a.reachable || b.reachable;
        return { ...n, condition, then, otherwise };
      }
      case 'while': {
        const entry = copyEnv(f.env);
        let head = copyEnv(entry);
        const run = (env: Environment) => {
          const iter: Flow = { env: copyEnv(env), reachable: true, returns: [] };
          const condition = expression(n.condition, iter), conditionExit = copyEnv(iter.env);
          const control: LoopControl = { breaks: [], continues: [] };
          const body = statement(n.body, iter, control) ?? emptyStatement(n.body);
          const backs = [...(iter.reachable ? [iter.env] : []), ...control.continues];
          return { condition, body, conditionExit, back: backs.length ? joinPaths(env, backs) : undefined,
            breaks: control.breaks, returns: iter.returns };
        };
        for (let i = 0; i < MAX_LOOP_FIXPOINT; i++) {
          const pass = run(head), next = widen(entry, pass.back ? [pass.back] : []);
          if (sameEnv(head, next)) break;
          head = next;
          if (i === MAX_LOOP_FIXPOINT - 1) fail('E_ANALYSIS', 'Loop type fixed point did not converge.', n.span);
        }
        const final = run(head);
        f.returns.push(...final.returns);
        const exits = [final.conditionExit, ...final.breaks];
        f.env = joinPaths(entry, exits); f.reachable = exits.length > 0;
        return { ...n, condition: final.condition, body: final.body };
      }
      case 'doWhile': {
        const entry = copyEnv(f.env);
        let head = copyEnv(entry);
        const run = (env: Environment) => {
          const iter: Flow = { env: copyEnv(env), reachable: true, returns: [] };
          const control: LoopControl = { breaks: [], continues: [] };
          const body = statement(n.body, iter, control) ?? emptyStatement(n.body);
          const backs = [...(iter.reachable ? [iter.env] : []), ...control.continues];
          let condition: SE, conditionExit: Environment | undefined, back: Environment | undefined;
          if (backs.length) {
            const test: Flow = { env: joinPaths(env, backs), reachable: true, returns: [] };
            condition = expression(n.condition, test); conditionExit = copyEnv(test.env); back = copyEnv(test.env);
          } else {
            const unreachable: Flow = { env: copyEnv(env), reachable: true, returns: [] };
            condition = expression(n.condition, unreachable);
          }
          return { condition, body, conditionExit, back, breaks: control.breaks, returns: iter.returns };
        };
        for (let i = 0; i < MAX_LOOP_FIXPOINT; i++) {
          const pass = run(head), next = widen(entry, pass.back ? [pass.back] : []);
          if (sameEnv(head, next)) break;
          head = next;
          if (i === MAX_LOOP_FIXPOINT - 1) fail('E_ANALYSIS', 'Loop type fixed point did not converge.', n.span);
        }
        const final = run(head);
        f.returns.push(...final.returns);
        const exits = [...(final.conditionExit ? [final.conditionExit] : []), ...final.breaks];
        if (exits.length) { f.env = joinPaths(entry, exits); f.reachable = true; } else f.reachable = false;
        return { ...n, body: final.body, condition: final.condition };
      }
      case 'for': {
        let initializer: SemanticForInitializer | undefined;
        if (n.initializer?.kind === 'variables') {
          const declarations = n.initializer.declarations.map(d => statement(d, f) as SS & { kind: 'variable' });
          initializer = { ...n.initializer, kind: 'variables', declarations };
        } else if (n.initializer?.kind === 'expression') {
          initializer = { ...n.initializer, kind: 'expression', expression: expression(n.initializer.expression, f) };
        }
        const entry = copyEnv(f.env);
        let head = copyEnv(entry);
        const run = (env: Environment) => {
          const iter: Flow = { env: copyEnv(env), reachable: true, returns: [] };
          let condition: SE | undefined, conditionExit: Environment | undefined;
          if (n.condition) { condition = expression(n.condition, iter); conditionExit = copyEnv(iter.env); }
          const control: LoopControl = { breaks: [], continues: [] };
          const body = statement(n.body, iter, control) ?? emptyStatement(n.body);
          const backs = [...(iter.reachable ? [iter.env] : []), ...control.continues];
          let update: SE | undefined, back: Environment | undefined;
          if (backs.length) {
            const updateFlow: Flow = { env: joinPaths(env, backs), reachable: true, returns: [] };
            if (n.update) update = expression(n.update, updateFlow);
            back = copyEnv(updateFlow.env);
          } else if (n.update) {
            const unreachable: Flow = { env: copyEnv(env), reachable: true, returns: [] };
            update = expression(n.update, unreachable);
          }
          return { condition, conditionExit, body, update, back, breaks: control.breaks, returns: iter.returns };
        };
        for (let i = 0; i < MAX_LOOP_FIXPOINT; i++) {
          const pass = run(head), next = widen(entry, pass.back ? [pass.back] : []);
          if (sameEnv(head, next)) break;
          head = next;
          if (i === MAX_LOOP_FIXPOINT - 1) fail('E_ANALYSIS', 'Loop type fixed point did not converge.', n.span);
        }
        const final = run(head);
        f.returns.push(...final.returns);
        const exits = [...(final.conditionExit ? [final.conditionExit] : []), ...final.breaks];
        if (exits.length) { f.env = joinPaths(entry, exits); f.reachable = true; } else f.reachable = false;
        return { ...n, initializer, condition: final.condition, update: final.update, body: final.body };
      }
    }
  }
  return { body: statements(program.body, { env: new Map(), reachable: true, returns: [] }), functions: instances };
}
