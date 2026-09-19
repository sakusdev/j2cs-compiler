import { fail } from '../diagnostics/index.js';
import type { Expr, Node, Program, Statement } from '../parser/ast.js';
import type { SemanticExpr as SE, SemanticFunction, SemanticProgram, SemanticStatement as SS } from '../ir/semantic.js';
import { type Binding, type Bindings } from './bindings.js';
import { exactly, literalType, union, type TypeSet } from './facts.js';
type Environment = Map<number, TypeSet>;
interface Flow { env: Environment; reachable: boolean; returns: TypeSet[] }
export function analyze(program: Program, bindings: Bindings): SemanticProgram {
  const instances: SemanticFunction[] = [], cache = new Map<string, SemanticFunction>(), active = new Set<number>();
  let nextInstance = 0;
  const syntheticUndefined = (n: Node): SE => ({ ...n, kind: 'literal', value: undefined, types: ['Undefined'] });
  function readType(b: Binding, n: Node, f: Flow): TypeSet {
    if (b.kind === 'intrinsic') return b.name === 'undefined' ? ['Undefined'] : ['Number'];
    const types = f.env.get(b.id);
    if (!types) fail('E_TDZ', `Binding '${b.name}' is accessed before initialization.`, n.span);
    return types;
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
        else if (n.op === '+') {
          if (exactly(left.types, 'String') || exactly(right.types, 'String')) types = ['String'];
          else types = left.types.includes('String') || right.types.includes('String') ? ['Number', 'String'] : ['Number'];
        } else types = ['Number'];
        return { ...n, left, right, types };
      }
      case 'unary': return { ...n, operand: expression(n.operand, f), types: [n.op === '!' ? 'Boolean' : 'Number'] };
      case 'assign': {
        const binding = bindings.references.get(n.target.id)!;
        readType(binding, n.target, f);
        const value = expression(n.value, f); f.env.set(binding.id, value.types);
        return { ...n, binding, value, types: value.types };
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
  function statements(nodes: Statement[], f: Flow): SS[] {
    const result: SS[] = [];
    for (const n of nodes) {
      if (!f.reachable) break; // Unreachable code has already passed parser and binding checks.
      const item = statement(n, f); if (item) result.push(item);
    }
    return result;
  }
  function statement(n: Statement, f: Flow): SS | undefined {
    switch (n.kind) {
      case 'empty': case 'function': return;
      case 'variable': {
        const binding = bindings.declarations.get(n.id)!;
        const initializer = n.initializer ? expression(n.initializer, f) : syntheticUndefined(n);
        f.env.set(binding.id, initializer.types); return { ...n, binding, initializer };
      }
      case 'expression': return { ...n, expression: expression(n.expression, f) };
      case 'block': return { ...n, body: statements(n.body, f) };
      case 'return': {
        const value = n.value ? expression(n.value, f) : syntheticUndefined(n);
        f.returns.push(value.types); f.reachable = false; return { ...n, value };
      }
      case 'if': {
        const condition = expression(n.condition, f);
        const a: Flow = { env: new Map(f.env), reachable: true, returns: [] };
        const b: Flow = { env: new Map(f.env), reachable: true, returns: [] };
        const then = statement(n.then, a) ?? { ...n.then, kind: 'block' as const, body: [] };
        const otherwise = n.otherwise && (statement(n.otherwise, b) ?? { ...n.otherwise, kind: 'block' as const, body: [] });
        for (const id of f.env.keys()) {
          const types = union(...[a, b].filter(x => x.reachable).map(x => x.env.get(id)!));
          if (types.length) f.env.set(id, types);
        }
        f.returns.push(...a.returns, ...b.returns); f.reachable = a.reachable || b.reachable;
        return { ...n, condition, then, otherwise };
      }
    }
  }
  return { body: statements(program.body, { env: new Map(), reachable: true, returns: [] }), functions: instances };
}
