import { fail } from '../diagnostics/index.js';
import type { Expr, Node, Program, Statement } from '../parser/ast.js';
import type { SemanticExpr as SE, SemanticForInitializer, SemanticFunction, SemanticProgram, SemanticStatement as SS } from '../ir/semantic.js';
import { type Binding, type Bindings } from './bindings.js';
import { exactly, hasReference, literalType, union, type TypeSet } from './facts.js';

interface ValueInfo { types: TypeSet; refs?: readonly number[]; functionIds?: readonly number[] }
interface Shape { kind: 'Object' | 'Array'; properties: Map<string, ValueInfo>; length?: number }
type Environment = Map<number, ValueInfo>;
interface Flow { env: Environment; heap: Map<number, Shape>; reachable: boolean; returns: ValueInfo[]; loopDepth: number; owner: number }
interface State { env: Environment; heap: Map<number, Shape> }
interface LoopControl { breaks: State[]; continues: State[] }
const MAX_LOOP_FIXPOINT = 16;
const UNDEFINED: ValueInfo = { types: ['Undefined'] };
const objectPrototypeKeys = new Set(['__proto__', 'constructor', 'hasOwnProperty', 'isPrototypeOf',
  'propertyIsEnumerable', 'toLocaleString', 'toString', 'valueOf', '__defineGetter__', '__defineSetter__',
  '__lookupGetter__', '__lookupSetter__']);
const arrayPrototypeKeys = new Set(['at', 'concat', 'copyWithin', 'entries', 'every', 'fill', 'filter', 'find',
  'findIndex', 'findLast', 'findLastIndex', 'flat', 'flatMap', 'forEach', 'includes', 'indexOf', 'join', 'keys',
  'lastIndexOf', 'map', 'pop', 'push', 'reduce', 'reduceRight', 'reverse', 'shift', 'slice', 'some', 'sort',
  'splice', 'toLocaleString', 'toReversed', 'toSorted', 'toSpliced', 'toString', 'unshift', 'values', 'with']);

export function analyze(program: Program, bindings: Bindings): SemanticProgram {
  const instances: SemanticFunction[] = [], cache = new Map<string, SemanticFunction>();
  const summaries = new Map<number, ValueInfo>();
  const functionById = new Map(bindings.functions.map(b => [b.id, b]));
  let nextInstance = 0;
  const syntheticUndefined = (n: Node): SE => ({ ...n, kind: 'literal', value: undefined, types: ['Undefined'] });
  const valueOf = (e: SE): ValueInfo => ({ types: e.types, ...(e.refs ? { refs: e.refs } : {}),
    ...(e.functionIds ? { functionIds: e.functionIds } : {}) });
  const cloneValue = (v: ValueInfo): ValueInfo => ({ types: v.types, ...(v.refs ? { refs: [...v.refs] } : {}),
    ...(v.functionIds ? { functionIds: [...v.functionIds] } : {}) });
  const withValue = <T extends object>(node: T, value: ValueInfo): T & ValueInfo =>
    ({ ...node, types: value.types, ...(value.refs ? { refs: value.refs } : {}) });

  function unionValue(...values: ValueInfo[]): ValueInfo {
    const types = union(...values.map(v => v.types));
    const refs = [...new Set(values.flatMap(v => v.refs ?? []))].sort((a, b) => a - b);
    const functionIds = [...new Set(values.flatMap(v => v.functionIds ?? []))].sort((a, b) => a - b);
    return { types, ...(refs.length ? { refs } : {}), ...(functionIds.length ? { functionIds } : {}) };
  }
  function functionValue(binding: Binding): ValueInfo { return { types: ['Function'], functionIds: [binding.id] }; }
  function record(binding: Binding, value: ValueInfo): void {
    const old = summaries.get(binding.id);
    summaries.set(binding.id, old ? unionValue(old, value) : cloneValue(value));
  }
  function applyCapturedSummaries(f: Flow): void {
    for (const id of bindings.capturedIds) {
      const current = f.env.get(id), summary = summaries.get(id);
      if (current && summary) f.env.set(id, unionValue(current, summary));
    }
  }
  function cloneEnv(env: Environment): Environment {
    return new Map([...env].map(([id, v]) => [id, cloneValue(v)]));
  }
  function cloneHeap(heap: Map<number, Shape>): Map<number, Shape> {
    return new Map([...heap].map(([id, s]) => [id, { kind: s.kind, length: s.length,
      properties: new Map([...s.properties].map(([k, v]) => [k, cloneValue(v)])) }]));
  }
  function stateOf(f: Flow): State { return { env: cloneEnv(f.env), heap: cloneHeap(f.heap) }; }
  function joinEnv(template: Environment, paths: Environment[]): Environment {
    const ids = new Set<number>([...template.keys(), ...paths.flatMap(p => [...p.keys()])]);
    const result = new Map<number, ValueInfo>();
    for (const id of ids) {
      const values = paths.map(p => p.get(id)).filter((x): x is ValueInfo => x !== undefined);
      if (values.length) result.set(id, unionValue(...values));
    }
    return result;
  }
  function joinHeaps(paths: Map<number, Shape>[]): Map<number, Shape> {
    const result = new Map<number, Shape>();
    const ids = new Set<number>(paths.flatMap(p => [...p.keys()]));
    for (const id of ids) {
      const shapes = paths.map(p => p.get(id)).filter((x): x is Shape => x !== undefined);
      if (!shapes.length) continue;
      const properties = new Map<string, ValueInfo>();
      const keys = new Set<string>(shapes.flatMap(s => [...s.properties.keys()]));
      for (const key of keys)
        properties.set(key, unionValue(...shapes.map(s => s.properties.get(key) ?? UNDEFINED)));
      const lengths = shapes.map(s => s.length);
      const length = lengths.every(x => x === lengths[0]) ? lengths[0] : undefined;
      result.set(id, { kind: shapes[0]!.kind, length, properties });
    }
    return result;
  }
  function joinStates(template: State, paths: State[]): State {
    if (!paths.length) return { env: cloneEnv(template.env), heap: cloneHeap(template.heap) };
    return { env: joinEnv(template.env, paths.map(p => p.env)), heap: joinHeaps(paths.map(p => p.heap)) };
  }
  function widen(base: State, paths: State[]): State { return joinStates(base, [base, ...paths]); }
  function sameValue(a: ValueInfo, b: ValueInfo): boolean {
    const ar=a.refs??[], br=b.refs??[], af=a.functionIds??[], bf=b.functionIds??[];
    return a.types.length===b.types.length && a.types.every((t,i)=>t===b.types[i])
      && ar.length===br.length && ar.every((x,i)=>x===br[i])
      && af.length===bf.length && af.every((x,i)=>x===bf[i]);
  }
  function sameEnv(a: Environment, b: Environment): boolean {
    if (a.size !== b.size) return false;
    for (const [id, v] of a) { const other=b.get(id); if (!other || !sameValue(v, other)) return false; }
    return true;
  }
  function sameHeap(a: Map<number, Shape>, b: Map<number, Shape>): boolean {
    if (a.size !== b.size) return false;
    for (const [id, x] of a) {
      const y=b.get(id); if (!y || x.kind!==y.kind || x.length!==y.length || x.properties.size!==y.properties.size) return false;
      for (const [k,v] of x.properties) { const w=y.properties.get(k); if(!w || !sameValue(v,w)) return false; }
    }
    return true;
  }
  function sameState(a: State, b: State): boolean { return sameEnv(a.env,b.env) && sameHeap(a.heap,b.heap); }
  function applyState(f: Flow, s: State): void { f.env=s.env; f.heap=s.heap; }
  function emptyStatement(n: Statement): SS { return { ...n, kind: 'block', body: [] }; }

  function readType(b: Binding, n: Node, f: Flow): ValueInfo {
    if (b.kind === 'intrinsic') {
      if (b.name === 'undefined') return { types: ['Undefined'] };
      if (b.name === 'NaN' || b.name === 'Infinity') return { types: ['Number'] };
      return fail('E_INTRINSIC_ESCAPE', `Intrinsic '${b.name}' is not a first-class value in this profile.`, n.span);
    }
    const value = f.env.get(b.id), summary = summaries.get(b.id);
    if (value) return bindings.capturedIds.has(b.id) && summary ? unionValue(value, summary) : value;
    if (b.owner !== f.owner && summary) return summary;
    if (b.kind === 'function') return functionValue(b);
    return fail('E_TDZ', `Binding '${b.name}' is accessed before initialization.`, n.span);
  }
  function addTypes(left: TypeSet, right: TypeSet): TypeSet {
    if (hasReference(left) || hasReference(right)) return ['Number', 'String'];
    if (exactly(left, 'String') || exactly(right, 'String')) return ['String'];
    return left.includes('String') || right.includes('String') ? ['Number', 'String'] : ['Number'];
  }
  function requireReference(value: SE, f: Flow, operation: string): readonly number[] {
    if (value.types.includes('Function'))
      fail('E_FUNCTION_PROPERTY', `${operation} on function objects requires callable-object property semantics that are deferred.`, value.span);
    if (value.types.some(t => t !== 'Object' && t !== 'Array') || !value.refs?.length)
      fail('E_PROPERTY_RECEIVER', `${operation} requires a proven compiler-owned Object/Array receiver.`, value.span);
    for (const ref of value.refs) if (!f.heap.has(ref)) fail('E_PROPERTY_FLOW', 'Object identity escaped the analyzable heap.', value.span);
    return value.refs;
  }
  function ownRead(receiver: SE, property: string, f: Flow): ValueInfo {
    const refs = requireReference(receiver, f, 'Property read');
    const values: ValueInfo[] = [];
    for (const ref of refs) {
      const shape = f.heap.get(ref)!;
      const own = shape.properties.get(property);
      if (own) { values.push(own); continue; }
      if (property === '__proto__' || objectPrototypeKeys.has(property) || (shape.kind === 'Array' && arrayPrototypeKeys.has(property)))
        fail('E_PROTOTYPE_PROPERTY', `Property '${property}' may resolve through an unimplemented prototype.`, receiver.span);
      values.push(UNDEFINED);
    }
    return unionValue(...values);
  }
  function setOwn(receiver: SE, property: string, value: ValueInfo, f: Flow): void {
    const refs = requireReference(receiver, f, 'Property write');
    if (property === '__proto__') fail('E_PROTOTYPE_MUTATION', '__proto__ assignment requires prototype-setter semantics.', receiver.span);
    for (const ref of refs) {
      const shape = f.heap.get(ref)!;
      if (shape.kind === 'Array' && property === 'length')
        fail('E_ARRAY_LENGTH_WRITE', 'Direct Array length writes are deferred until full ArraySetLength semantics are implemented.', receiver.span);
      shape.properties.set(property, value);
      if (shape.kind === 'Array' && shape.length !== undefined && /^(?:0|[1-9]\d*)$/.test(property)) {
        const index = Number(property);
        if (Number.isSafeInteger(index) && index >= 0 && index <= 0xffff_fffe) shape.length = Math.max(shape.length, index + 1);
      }
    }
  }
  function guessedReturnTypes(b: Binding, params: Map<number, ValueInfo>): TypeSet {
    const guesses: TypeSet[] = [];
    const guess = (n: Expr): TypeSet | undefined => {
      switch (n.kind) {
        case 'literal': return literalType(n.value);
        case 'functionExpr': return ['Function'];
        case 'identifier': {
          const binding = bindings.references.get(n.id);
          if (!binding) return;
          if (binding.kind === 'intrinsic') {
            if (binding.name === 'undefined') return ['Undefined'];
            if (binding.name === 'NaN' || binding.name === 'Infinity') return ['Number'];
            return;
          }
          return params.get(binding.id)?.types ?? summaries.get(binding.id)?.types
            ?? (binding.kind === 'function' ? ['Function'] : undefined);
        }
        case 'binary': {
          if (['<', '<=', '>', '>=', '==', '!=', '===', '!=='].includes(n.op)) return ['Boolean'];
          if (n.op !== '+') return ['Number'];
          const l=guess(n.left), r=guess(n.right);
          return l && r ? addTypes(l,r) : ['Number','String'];
        }
        case 'unary': return [n.op === '!' ? 'Boolean' : 'Number'];
        case 'assign': return guess(n.value);
        case 'compound': return n.op === '+=' ? ['Number','String'] : ['Number'];
        case 'update': return ['Number'];
        case 'object': return ['Object'];
        case 'array': return ['Array'];
        case 'member': case 'call': return;
      }
    };
    const scan = (nodes: Statement[]): void => {
      for (const n of nodes) {
        if (n.kind === 'return') guesses.push(n.value ? (guess(n.value) ?? []) : ['Undefined']);
        else if (n.kind === 'block') scan(n.body);
        else if (n.kind === 'if') {
          if (n.then.kind === 'block') scan(n.then.body); else scan([n.then]);
          if (n.otherwise) n.otherwise.kind === 'block' ? scan(n.otherwise.body) : scan([n.otherwise]);
        } else if (n.kind === 'while' || n.kind === 'doWhile' || n.kind === 'for') {
          n.body.kind === 'block' ? scan(n.body.body) : scan([n.body]);
        }
      }
    };
    scan(b.function!.body.body);
    const useful=guesses.filter(g=>g.length);
    return useful.length ? union(...useful) : ['Undefined'];
  }

  function instantiate(b: Binding, args: SE[], callNode: Node): SemanticFunction {
    const fn = b.function!;
    if (args.some(a => a.types.some(t => t === 'Object' || t === 'Array')))
      fail('E_OBJECT_FUNCTION_BOUNDARY', 'Object/Array arguments require alias/effect summaries and are deferred.', callNode.span);
    const params = fn.params.map(p => bindings.declarations.get(p.id)!);
    const formal = params.map((_, i) => args[i] ?? syntheticUndefined(callNode));
    const key = `${b.id}:${formal.map(a => `${a.types.join('|')}#${(a.functionIds??[]).join('|')}`).join(',')}`;
    const found = cache.get(key); if (found) return found;
    const seedEnv = new Map(params.map((p, i) => [p.id, valueOf(formal[i]!)]));
    const instance: SemanticFunction = {
      ...fn, instanceId: nextInstance++, binding: b, params, body: [],
      returnTypes: guessedReturnTypes(b, seedEnv), returnFunctionIds: [],
    };
    instances.push(instance); cache.set(key, instance);
    let previousTypes = '', previousFunctions = '';
    for (let pass=0; pass<8; pass++) {
      const f: Flow = { env: new Map(params.map((p, i) => [p.id, valueOf(formal[i]!) ])),
        heap: new Map(), reachable: true, returns: [], loopDepth: 0, owner: fn.id + 1 };
      params.forEach((p,i)=>record(p,valueOf(formal[i]!)));
      const body = statements(fn.body.body, f);
      if (f.reachable) {
        const value = syntheticUndefined(fn.body);
        body.push({ ...fn.body, kind: 'return', value }); f.returns.push(valueOf(value));
      }
      const returnTypes = f.returns.length ? union(...f.returns.map(r=>r.types)) : ['Undefined'] as TypeSet;
      const returnFunctionIds = [...new Set(f.returns.flatMap(r=>r.functionIds??[]))].sort((a,b)=>a-b);
      instance.body = body; instance.returnTypes = returnTypes; instance.returnFunctionIds = returnFunctionIds;
      const typeKey=returnTypes.join('|'), functionKey=returnFunctionIds.join('|');
      if (typeKey===previousTypes && functionKey===previousFunctions) break;
      previousTypes=typeKey; previousFunctions=functionKey;
    }
    return instance;
  }

  function expression(n: Expr, f: Flow): SE {
    switch (n.kind) {
      case 'literal': return { ...n, types: literalType(n.value) };
      case 'functionExpr': {
        const binding = bindings.declarations.get(n.id)!;
        return withValue({ ...n, kind: 'functionValue' as const, binding }, functionValue(binding));
      }
      case 'object': {
        if (f.loopDepth) fail('E_OBJECT_LOOP_ALLOCATION', 'Object allocation inside loops requires per-iteration identity modeling and is deferred.', n.span);
        const ref = n.id, shape: Shape = { kind: 'Object', properties: new Map() };
        f.heap.set(ref, shape);
        const properties = n.properties.map(p => {
          const value = expression(p.value, f); shape.properties.set(p.key, valueOf(value)); return { key: p.key, value };
        });
        return { ...n, kind: 'object', properties, types: ['Object'], refs: [ref] };
      }
      case 'array': {
        if (f.loopDepth) fail('E_OBJECT_LOOP_ALLOCATION', 'Array allocation inside loops requires per-iteration identity modeling and is deferred.', n.span);
        const ref = n.id, shape: Shape = { kind: 'Array', length: n.elements.length, properties: new Map() };
        f.heap.set(ref, shape);
        const elements = n.elements.map((e, i) => {
          if (!e) return null;
          const value = expression(e, f); shape.properties.set(String(i), valueOf(value)); return value;
        });
        return { ...n, kind: 'array', elements, types: ['Array'], refs: [ref] };
      }
      case 'identifier': {
        const binding = bindings.references.get(n.id)!;
        return withValue({ ...n, kind: 'read' as const, binding }, readType(binding, n, f));
      }
      case 'binary': {
        const left = expression(n.left, f), right = expression(n.right, f);
        let types: TypeSet;
        if (['<', '<=', '>', '>=', '==', '!=', '===', '!=='].includes(n.op)) types = ['Boolean'];
        else if (n.op === '+') types = addTypes(left.types, right.types);
        else types = ['Number'];
        return { ...n, left, right, types };
      }
      case 'unary': return { ...n, operand: expression(n.operand, f), types: [n.op === '!' ? 'Boolean' : 'Number'] };
      case 'assign': {
        if (n.target.kind === 'identifier') {
          const binding = bindings.references.get(n.target.id)!;
          readType(binding, n.target, f);
          const value = expression(n.value, f); f.env.set(binding.id, valueOf(value)); record(binding, valueOf(value));
          return withValue({ ...n, kind: 'assign' as const, binding, value }, valueOf(value));
        }
        const object = expression(n.target.object, f), value = expression(n.value, f);
        setOwn(object, n.target.property, valueOf(value), f);
        return withValue({ ...n, kind: 'propertyAssign' as const, object, property: n.target.property, value }, valueOf(value));
      }
      case 'compound': {
        const binding = bindings.references.get(n.target.id)!;
        const left = readType(binding, n.target, f), value = expression(n.value, f);
        const types = n.op === '+=' ? addTypes(left.types, value.types) : ['Number'] as TypeSet;
        const next = { types } as ValueInfo; f.env.set(binding.id, next); record(binding, next);
        return { ...n, binding, leftTypes: left.types, value, types };
      }
      case 'update': {
        const binding = bindings.references.get(n.target.id)!;
        const operand = readType(binding, n.target, f), types: TypeSet = ['Number'];
        const next = { types } as ValueInfo; f.env.set(binding.id, next); record(binding, next);
        return { ...n, binding, operandTypes: operand.types, types };
      }
      case 'member': {
        const object = expression(n.object, f);
        const refs = requireReference(object, f, 'Property read');
        if (n.property === 'length' && refs.every(r => f.heap.get(r)!.kind === 'Array'))
          return { ...n, object, types: ['Number'] };
        return withValue({ ...n, object }, ownRead(object, n.property, f));
      }
      case 'call': {
        if (n.callee.kind === 'member') {
          if (n.callee.object.kind === 'identifier') {
            const binding = bindings.references.get(n.callee.object.id)!;
            if (n.callee.object.name === 'console' && (binding?.kind !== 'intrinsic' || binding.name !== 'console'))
              fail('E_INTRINSIC_SHADOWED', 'console.log does not resolve to the pristine Node console intrinsic.', n.span);
            if (binding?.kind === 'intrinsic' && binding.name === 'console' && n.callee.property === 'log') {
              const args = n.args.map(a => expression(a, f));
              if (args.some(a => hasReference(a.types)))
                fail('E_CONSOLE_OBJECT', 'Object/Array/Function console inspection is outside the primitive console host contract.', n.span);
              if (args.length > 1 && args[0]!.types.includes('String')) {
                const first = args[0]!;
                if (first.kind !== 'literal' || typeof first.value !== 'string' || first.value.includes('%'))
                  fail('E_CONSOLE_FORMAT', 'Multi-argument console.log with a possible format string needs Node util.format support.', n.span);
              }
              return { ...n, kind: 'call', target: 'console', binding, args, arity: args.length, types: ['Undefined'] };
            }
            if (binding?.kind === 'intrinsic' && binding.name === 'Object' && n.callee.property === 'hasOwn') {
              if (n.args.length !== 2) fail('E_ARITY', 'Object.hasOwn is supported only with exactly two arguments.', n.span);
              const receiver = expression(n.args[0]!, f); requireReference(receiver, f, 'Object.hasOwn');
              const key = n.args[1]!;
              if (key.kind !== 'literal' || (typeof key.value !== 'string' && typeof key.value !== 'number'))
                fail('E_PROPERTY_KEY_COERCION', 'Object.hasOwn currently requires a static String/Number key; general ToPropertyKey is deferred.', key.span);
              return { ...n, kind: 'call', target: 'object.hasOwn', binding, receiver,
                property: typeof key.value === 'number' ? String(key.value) : key.value, args: [], arity: 2, types: ['Boolean'] };
            }
          }
          if (n.callee.property === 'push') {
            const receiver = expression(n.callee.object, f), refs = requireReference(receiver, f, 'Array.prototype.push');
            if (!exactly(receiver.types, 'Array') || refs.some(r => f.heap.get(r)!.kind !== 'Array'))
              fail('E_ARRAY_RECEIVER', 'push requires a proven builtin Array receiver.', n.span);
            if (refs.some(r => f.heap.get(r)!.properties.has('push')))
              fail('E_ARRAY_METHOD_OVERRIDDEN', 'An own push property makes builtin Array.prototype.push resolution unproven.', n.span);
            const args = n.args.map(a => expression(a, f));
            for (const ref of refs) {
              const shape = f.heap.get(ref)!;
              if (shape.length !== undefined) {
                let index = shape.length;
                for (const arg of args) shape.properties.set(String(index++), valueOf(arg));
                shape.length = index;
              }
            }
            return { ...n, kind: 'call', target: 'array.push', receiver, args, arity: args.length, types: ['Number'] };
          }
          fail('E_INDIRECT_CALL', `Member call '.${n.callee.property}' is not a proven supported intrinsic.`, n.span);
        }
        if (n.callee.kind === 'identifier') {
          const direct = bindings.references.get(n.callee.id)!;
          if (direct.kind === 'intrinsic') {
            if (!['isFinite', 'isNaN', 'parseFloat', 'parseInt'].includes(direct.name))
              fail('E_INDIRECT_CALL', `Calling '${direct.name}' requires callable runtime support.`, n.span);
            const target = direct.name as 'isFinite' | 'isNaN' | 'parseFloat' | 'parseInt';
            const args = n.args.map(a => expression(a, f));
            const validArity = target === 'parseInt' ? args.length === 1 || args.length === 2 : args.length === 1;
            if (!validArity) fail('E_ARITY', `Intrinsic ${target} is currently supported only at its reviewed arity.`, n.span);
            return { ...n, kind: 'call', binding: direct, target, args, arity: args.length,
              types: target === 'isFinite' || target === 'isNaN' ? ['Boolean'] : ['Number'] };
          }
        }
        const callee = expression(n.callee, f);
        if (!exactly(callee.types, 'Function') || !callee.functionIds?.length)
          fail('E_INDIRECT_CALL', 'Call target is not proven to be a supported JavaScript function value.', n.span);
        if (callee.functionIds.length !== 1)
          fail('E_AMBIGUOUS_CALLABLE', 'Call target may denote multiple function templates; runtime template dispatch is deferred.', n.span);
        const binding = functionById.get(callee.functionIds[0]!)!;
        const args = n.args.map(a => expression(a, f)), instance = instantiate(binding, args, n);
        applyCapturedSummaries(f);
        const callMode = args.length < instance.params.length ? 'missing' : args.length > instance.params.length ? 'extra' : 'exact';
        return { ...n, kind: 'call', binding, target: instance.instanceId, callee, args, arity: instance.params.length,
          callMode, types: instance.returnTypes, ...(instance.returnFunctionIds.length ? { functionIds: instance.returnFunctionIds } : {}) };
      }
    }
  }

  function statements(nodes: Statement[], f: Flow, loop?: LoopControl): SS[] {
    for (const n of nodes) {
      if (n.kind !== 'function') continue;
      const binding = bindings.declarations.get(n.id)!;
      const value = functionValue(binding); f.env.set(binding.id, value); record(binding, value);
    }
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
        f.env.set(binding.id, valueOf(initializer)); record(binding, valueOf(initializer)); return { ...n, binding, initializer };
      }
      case 'expression': return { ...n, expression: expression(n.expression, f) };
      case 'block': return { ...n, body: statements(n.body, f, loop) };
      case 'return': {
        const value = n.value ? expression(n.value, f) : syntheticUndefined(n);
        f.returns.push(valueOf(value)); f.reachable = false; return { ...n, value };
      }
      case 'break': {
        if (!loop) return fail('E_BREAK_CONTEXT', 'break outside a loop is unsupported.', n.span);
        loop.breaks.push(stateOf(f)); f.reachable = false; return { ...n, kind: 'break' };
      }
      case 'continue': {
        if (!loop) return fail('E_CONTINUE_CONTEXT', 'continue outside a loop is unsupported.', n.span);
        loop.continues.push(stateOf(f)); f.reachable = false; return { ...n, kind: 'continue' };
      }
      case 'if': {
        const condition = expression(n.condition, f);
        const a: Flow = { env: cloneEnv(f.env), heap: cloneHeap(f.heap), reachable: true, returns: [], loopDepth: f.loopDepth, owner: f.owner };
        const b: Flow = { env: cloneEnv(f.env), heap: cloneHeap(f.heap), reachable: true, returns: [], loopDepth: f.loopDepth, owner: f.owner };
        const then = statement(n.then, a, loop) ?? emptyStatement(n.then);
        const otherwise = n.otherwise && (statement(n.otherwise, b, loop) ?? emptyStatement(n.otherwise));
        const live = [a, b].filter(x => x.reachable);
        if (live.length) {
          f.env = joinEnv(f.env, live.map(x => x.env));
          f.heap = joinHeaps(live.map(x => x.heap));
        }
        f.returns.push(...a.returns, ...b.returns); f.reachable = live.length > 0;
        return { ...n, condition, then, otherwise };
      }
      case 'while': {
        const entry = stateOf(f);
        let head = stateOf(f);
        const run = (state: State) => {
          const iter: Flow = { env: cloneEnv(state.env), heap: cloneHeap(state.heap), reachable: true, returns: [], loopDepth: f.loopDepth + 1, owner: f.owner };
          const condition = expression(n.condition, iter), conditionExit = stateOf(iter);
          const control: LoopControl = { breaks: [], continues: [] };
          const body = statement(n.body, iter, control) ?? emptyStatement(n.body);
          const backs = [...(iter.reachable ? [stateOf(iter)] : []), ...control.continues];
          return { condition, body, conditionExit, back: backs.length ? joinStates(state, backs) : undefined,
            breaks: control.breaks, returns: iter.returns };
        };
        for (let i=0;i<MAX_LOOP_FIXPOINT;i++) {
          const pass=run(head), next=widen(entry, pass.back ? [pass.back] : []);
          if (sameState(head,next)) break;
          head=next; if(i===MAX_LOOP_FIXPOINT-1) fail('E_ANALYSIS','Loop fixed point did not converge.',n.span);
        }
        const final=run(head); f.returns.push(...final.returns);
        const exits=[final.conditionExit,...final.breaks];
        applyState(f, joinStates(entry,exits)); f.reachable=exits.length>0;
        return { ...n, condition: final.condition, body: final.body };
      }
      case 'doWhile': {
        const entry=stateOf(f); let head=stateOf(f);
        const run=(state:State)=>{
          const iter:Flow={env:cloneEnv(state.env),heap:cloneHeap(state.heap),reachable:true,returns:[],loopDepth:f.loopDepth+1,owner:f.owner};
          const control:LoopControl={breaks:[],continues:[]};
          const body=statement(n.body,iter,control)??emptyStatement(n.body);
          const backs=[...(iter.reachable?[stateOf(iter)]:[]),...control.continues];
          let condition:SE, conditionExit:State|undefined, back:State|undefined;
          if(backs.length){
            const testState=joinStates(state,backs);
            const test:Flow={env:cloneEnv(testState.env),heap:cloneHeap(testState.heap),reachable:true,returns:[],loopDepth:f.loopDepth+1,owner:f.owner};
            condition=expression(n.condition,test); conditionExit=stateOf(test); back=stateOf(test);
          } else {
            const unreachable:Flow={env:cloneEnv(state.env),heap:cloneHeap(state.heap),reachable:true,returns:[],loopDepth:f.loopDepth+1,owner:f.owner};
            condition=expression(n.condition,unreachable);
          }
          return {condition,body,conditionExit,back,breaks:control.breaks,returns:iter.returns};
        };
        for(let i=0;i<MAX_LOOP_FIXPOINT;i++){
          const pass=run(head),next=widen(entry,pass.back?[pass.back]:[]);
          if(sameState(head,next))break;
          head=next;if(i===MAX_LOOP_FIXPOINT-1)fail('E_ANALYSIS','Loop fixed point did not converge.',n.span);
        }
        const final=run(head);f.returns.push(...final.returns);
        const exits=[...(final.conditionExit?[final.conditionExit]:[]),...final.breaks];
        if(exits.length){applyState(f,joinStates(entry,exits));f.reachable=true}else f.reachable=false;
        return {...n,body:final.body,condition:final.condition};
      }
      case 'for': {
        let initializer: SemanticForInitializer | undefined;
        if(n.initializer?.kind==='variables'){
          const declarations=n.initializer.declarations.map(d=>statement(d,f) as SS & {kind:'variable'});
          initializer={...n.initializer,kind:'variables',declarations};
        }else if(n.initializer?.kind==='expression'){
          initializer={...n.initializer,kind:'expression',expression:expression(n.initializer.expression,f)};
        }
        const entry=stateOf(f);let head=stateOf(f);
        const run=(state:State)=>{
          const iter:Flow={env:cloneEnv(state.env),heap:cloneHeap(state.heap),reachable:true,returns:[],loopDepth:f.loopDepth+1,owner:f.owner};
          let condition:SE|undefined,conditionExit:State|undefined;
          if(n.condition){condition=expression(n.condition,iter);conditionExit=stateOf(iter)}
          const control:LoopControl={breaks:[],continues:[]};
          const body=statement(n.body,iter,control)??emptyStatement(n.body);
          const backs=[...(iter.reachable?[stateOf(iter)]:[]),...control.continues];
          let update:SE|undefined,back:State|undefined;
          if(backs.length){
            const updateState=joinStates(state,backs);
            const updateFlow:Flow={env:cloneEnv(updateState.env),heap:cloneHeap(updateState.heap),reachable:true,returns:[],loopDepth:f.loopDepth+1,owner:f.owner};
            if(n.update)update=expression(n.update,updateFlow);
            back=stateOf(updateFlow);
          }else if(n.update){
            const unreachable:Flow={env:cloneEnv(state.env),heap:cloneHeap(state.heap),reachable:true,returns:[],loopDepth:f.loopDepth+1,owner:f.owner};
            update=expression(n.update,unreachable);
          }
          return {condition,conditionExit,body,update,back,breaks:control.breaks,returns:iter.returns};
        };
        for(let i=0;i<MAX_LOOP_FIXPOINT;i++){
          const pass=run(head),next=widen(entry,pass.back?[pass.back]:[]);
          if(sameState(head,next))break;
          head=next;if(i===MAX_LOOP_FIXPOINT-1)fail('E_ANALYSIS','Loop fixed point did not converge.',n.span);
        }
        const final=run(head);f.returns.push(...final.returns);
        const exits=[...(final.conditionExit?[final.conditionExit]:[]),...final.breaks];
        if(exits.length){applyState(f,joinStates(entry,exits));f.reachable=true}else f.reachable=false;
        return {...n,initializer,condition:final.condition,update:final.update,body:final.body};
      }
    }
  }

  return { body: statements(program.body, { env: new Map(), heap: new Map(), reachable: true, returns: [], loopDepth: 0, owner: 0 }),
    functions: instances, templates: bindings.functions, captures: bindings.captures };
}
