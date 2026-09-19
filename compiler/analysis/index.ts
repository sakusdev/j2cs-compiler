import { fail } from '../diagnostics/index.js';
import type { Expr, Node, Program, Statement } from '../parser/ast.js';
import type { SemanticExpr as SE, SemanticFunction, SemanticProgram, SemanticStatement as SS } from '../ir/semantic.js';
import { type Binding, type Bindings } from './bindings.js';
import { exactly, hasReference, literalType, union, type TypeSet } from './facts.js';

interface ValueInfo { types: TypeSet; refs?: readonly number[] }
interface Shape { kind: 'Object' | 'Array'; properties: Map<string, ValueInfo>; length?: number }
type Environment = Map<number, ValueInfo>;
interface Flow { env: Environment; heap: Map<number, Shape>; reachable: boolean; returns: TypeSet[] }
const UNDEFINED: ValueInfo = { types: ['Undefined'] };
const objectPrototypeKeys = new Set(['__proto__', 'constructor', 'hasOwnProperty', 'isPrototypeOf',
  'propertyIsEnumerable', 'toLocaleString', 'toString', 'valueOf', '__defineGetter__', '__defineSetter__',
  '__lookupGetter__', '__lookupSetter__']);
const arrayPrototypeKeys = new Set(['at', 'concat', 'copyWithin', 'entries', 'every', 'fill', 'filter', 'find',
  'findIndex', 'findLast', 'findLastIndex', 'flat', 'flatMap', 'forEach', 'includes', 'indexOf', 'join', 'keys',
  'lastIndexOf', 'map', 'pop', 'push', 'reduce', 'reduceRight', 'reverse', 'shift', 'slice', 'some', 'sort',
  'splice', 'toLocaleString', 'toReversed', 'toSorted', 'toSpliced', 'toString', 'unshift', 'values', 'with']);

export function analyze(program: Program, bindings: Bindings): SemanticProgram {
  const instances: SemanticFunction[] = [], cache = new Map<string, SemanticFunction>(), active = new Set<number>();
  let nextInstance = 0;
  const syntheticUndefined = (n: Node): SE => ({ ...n, kind: 'literal', value: undefined, types: ['Undefined'] });
  const valueOf = (e: SE): ValueInfo => ({ types: e.types, ...(e.refs ? { refs: e.refs } : {}) });
  const withValue = <T extends object>(node: T, value: ValueInfo): T & ValueInfo =>
    ({ ...node, types: value.types, ...(value.refs ? { refs: value.refs } : {}) });
  function unionValue(...values: ValueInfo[]): ValueInfo {
    const types = union(...values.map(v => v.types));
    const refs = [...new Set(values.flatMap(v => v.refs ?? []))].sort((a, b) => a - b);
    return { types, ...(refs.length ? { refs } : {}) };
  }
  function cloneHeap(heap: Map<number, Shape>): Map<number, Shape> {
    return new Map([...heap].map(([id, s]) => [id, { kind: s.kind, length: s.length,
      properties: new Map([...s.properties].map(([k, v]) => [k, { ...v, ...(v.refs ? { refs: [...v.refs] } : {}) }])) }]));
  }
  function mergeHeap(target: Map<number, Shape>, a: Map<number, Shape>, b: Map<number, Shape>): void {
    target.clear();
    for (const id of new Set([...a.keys(), ...b.keys()])) {
      const x = a.get(id), y = b.get(id);
      if (!x || !y) {
        const s = x ?? y!;
        target.set(id, { kind: s.kind, length: s.length, properties: new Map(s.properties) });
        continue;
      }
      const properties = new Map<string, ValueInfo>();
      for (const key of new Set([...x.properties.keys(), ...y.properties.keys()])) {
        properties.set(key, unionValue(x.properties.get(key) ?? UNDEFINED, y.properties.get(key) ?? UNDEFINED));
      }
      target.set(id, { kind: x.kind, length: x.length === y.length ? x.length : undefined, properties });
    }
  }
  function readType(b: Binding, n: Node, f: Flow): ValueInfo {
    if (b.kind === 'intrinsic') {
      if (b.name === 'undefined') return { types: ['Undefined'] };
      if (b.name === 'NaN' || b.name === 'Infinity') return { types: ['Number'] };
      return fail('E_INTRINSIC_ESCAPE', `Intrinsic '${b.name}' is not a first-class value in this profile.`, n.span);
    }
    const value = f.env.get(b.id);
    if (!value) fail('E_TDZ', `Binding '${b.name}' is accessed before initialization.`, n.span);
    return value;
  }
  function requireReference(value: SE, f: Flow, operation: string): readonly number[] {
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
  function instantiate(b: Binding, args: SE[], call: Node): SemanticFunction {
    const fn = b.function!;
    if (args.length !== fn.params.length) fail('E_ARITY', 'Only exact-arity direct function calls are supported.', call.span);
    if (args.some(a => hasReference(a.types)))
      fail('E_OBJECT_FUNCTION_BOUNDARY', 'Object/Array arguments require alias/effect summaries and are deferred.', call.span);
    if (active.has(b.id)) fail('E_RECURSION', 'Recursive call graphs require a summary fixed point; unsupported in this MVP.', call.span);
    const key = `${b.id}:${args.map(a => a.types.join('|')).join(',')}`;
    const found = cache.get(key); if (found) return found;
    active.add(b.id);
    const instanceId = nextInstance++, params = fn.params.map(p => bindings.declarations.get(p.id)!);
    const f: Flow = { env: new Map(params.map((p, i) => [p.id, valueOf(args[i]!)])), heap: new Map(), reachable: true, returns: [] };
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
      case 'object': {
        if (active.size) fail('E_OBJECT_FUNCTION_BOUNDARY', 'Object literals inside specialized functions require per-call heap summaries and are deferred.', n.span);
        const ref = n.id, shape: Shape = { kind: 'Object', properties: new Map() };
        f.heap.set(ref, shape);
        const properties = n.properties.map(p => {
          const value = expression(p.value, f); shape.properties.set(p.key, valueOf(value)); return { key: p.key, value };
        });
        return { ...n, kind: 'object', properties, types: ['Object'], refs: [ref] };
      }
      case 'array': {
        if (active.size) fail('E_OBJECT_FUNCTION_BOUNDARY', 'Array literals inside specialized functions require per-call heap summaries and are deferred.', n.span);
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
        if (['<', '<=', '>', '>=', '===', '!=='].includes(n.op)) types = ['Boolean'];
        else if (n.op === '+') {
          if (exactly(left.types, 'String') || exactly(right.types, 'String')) types = ['String'];
          else types = left.types.includes('String') || right.types.includes('String') ? ['Number', 'String'] : ['Number'];
        } else types = ['Number'];
        return { ...n, left, right, types };
      }
      case 'unary': return { ...n, operand: expression(n.operand, f), types: [n.op === '!' ? 'Boolean' : 'Number'] };
      case 'assign': {
        if (n.target.kind === 'identifier') {
          const binding = bindings.references.get(n.target.id)!;
          readType(binding, n.target, f);
          const value = expression(n.value, f); f.env.set(binding.id, valueOf(value));
          return withValue({ ...n, kind: 'assign' as const, binding, value }, valueOf(value));
        }
        const object = expression(n.target.object, f), value = expression(n.value, f);
        setOwn(object, n.target.property, valueOf(value), f);
        return withValue({ ...n, kind: 'propertyAssign' as const, object, property: n.target.property, value }, valueOf(value));
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
                fail('E_CONSOLE_OBJECT', 'Object/Array console inspection is outside the primitive console host contract.', n.span);
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
      if (!f.reachable) break;
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
        f.env.set(binding.id, valueOf(initializer)); return { ...n, binding, initializer };
      }
      case 'expression': return { ...n, expression: expression(n.expression, f) };
      case 'block': return { ...n, body: statements(n.body, f) };
      case 'return': {
        const value = n.value ? expression(n.value, f) : syntheticUndefined(n);
        if (hasReference(value.types)) fail('E_OBJECT_FUNCTION_BOUNDARY', 'Returning Object/Array values from specialized functions is deferred.', n.span);
        f.returns.push(value.types); f.reachable = false; return { ...n, value };
      }
      case 'if': {
        const condition = expression(n.condition, f);
        const a: Flow = { env: new Map(f.env), heap: cloneHeap(f.heap), reachable: true, returns: [] };
        const b: Flow = { env: new Map(f.env), heap: cloneHeap(f.heap), reachable: true, returns: [] };
        const then = statement(n.then, a) ?? { ...n.then, kind: 'block' as const, body: [] };
        const otherwise = n.otherwise && (statement(n.otherwise, b) ?? { ...n.otherwise, kind: 'block' as const, body: [] });
        for (const id of f.env.keys()) {
          const values = [a, b].filter(x => x.reachable).map(x => x.env.get(id)!).filter(Boolean);
          if (values.length) f.env.set(id, unionValue(...values));
        }
        mergeHeap(f.heap, a.heap, b.heap);
        f.returns.push(...a.returns, ...b.returns); f.reachable = a.reachable || b.reachable;
        return { ...n, condition, then, otherwise };
      }
    }
  }
  return { body: statements(program.body, { env: new Map(), heap: new Map(), reachable: true, returns: [] }), functions: instances };
}
