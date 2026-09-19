import { fail } from '../diagnostics/index.js';
import type { Expr, Node, Program, Statement } from '../parser/ast.js';
import type { SemanticExpr as SE, SemanticForInitializer, SemanticFunction, SemanticProgram, SemanticStatement as SS } from '../ir/semantic.js';
import { type Binding, type Bindings } from './bindings.js';
import { exactly, hasReference, literalType, union, type TypeSet } from './facts.js';

interface ValueInfo { types: TypeSet; refs?: readonly number[] }
interface PropertyShape {
  value: ValueInfo;
  writable: boolean | undefined;
  enumerable: boolean | undefined;
  configurable: boolean | undefined;
}
interface PrototypeShape { refs: readonly number[]; includesNull: boolean; opaqueDefault: boolean }
interface Shape {
  kind: 'Object' | 'Array';
  properties: Map<string, PropertyShape>;
  prototype: PrototypeShape;
  length?: number;
}
type Environment = Map<number, ValueInfo>;
interface Flow { env: Environment; heap: Map<number, Shape>; reachable: boolean; returns: TypeSet[]; loopDepth: number }
interface State { env: Environment; heap: Map<number, Shape> }
interface LoopControl { breaks: State[]; continues: State[] }
const MAX_LOOP_FIXPOINT = 16;
const UNDEFINED: ValueInfo = { types: ['Undefined'] };
const ordinaryProperty = (value: ValueInfo): PropertyShape =>
  ({ value, writable: true, enumerable: true, configurable: true });
const opaqueDefaultPrototype = (): PrototypeShape => ({ refs: [], includesNull: false, opaqueDefault: true });
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
  const cloneValue = (v: ValueInfo): ValueInfo => ({ types: v.types, ...(v.refs ? { refs: [...v.refs] } : {}) });
  const withValue = <T extends object>(node: T, value: ValueInfo): T & ValueInfo =>
    ({ ...node, types: value.types, ...(value.refs ? { refs: value.refs } : {}) });

  function unionValue(...values: ValueInfo[]): ValueInfo {
    const types = union(...values.map(v => v.types));
    const refs = [...new Set(values.flatMap(v => v.refs ?? []))].sort((a, b) => a - b);
    return { types, ...(refs.length ? { refs } : {}) };
  }
  function cloneEnv(env: Environment): Environment {
    return new Map([...env].map(([id, v]) => [id, cloneValue(v)]));
  }
  function cloneProperty(p: PropertyShape): PropertyShape {
    return { value: cloneValue(p.value), writable: p.writable, enumerable: p.enumerable, configurable: p.configurable };
  }
  function clonePrototype(p: PrototypeShape): PrototypeShape {
    return { refs: [...p.refs], includesNull: p.includesNull, opaqueDefault: p.opaqueDefault };
  }
  function cloneHeap(heap: Map<number, Shape>): Map<number, Shape> {
    return new Map([...heap].map(([id, shape]) => [id, {
      kind: shape.kind,
      length: shape.length,
      prototype: clonePrototype(shape.prototype),
      properties: new Map([...shape.properties].map(([k, p]) => [k, cloneProperty(p)])),
    }]));
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
      const properties = new Map<string, PropertyShape>();
      const keys = new Set<string>(shapes.flatMap(shape => [...shape.properties.keys()]));
      for (const key of keys) {
        const present = shapes.map(shape => shape.properties.get(key));
        const first = present[0];
        const attr = (name: 'writable' | 'enumerable' | 'configurable'): boolean | undefined =>
          first && present.every(p => p && p[name] === first[name]) ? first[name] : undefined;
        properties.set(key, {
          value: unionValue(...present.map(p => p?.value ?? UNDEFINED)),
          writable: attr('writable'),
          enumerable: attr('enumerable'),
          configurable: attr('configurable'),
        });
      }
      const lengths = shapes.map(shape => shape.length);
      const length = lengths.every(x => x === lengths[0]) ? lengths[0] : undefined;
      const prototype: PrototypeShape = {
        refs: [...new Set(shapes.flatMap(shape => [...shape.prototype.refs]))].sort((a, b) => a - b),
        includesNull: shapes.some(shape => shape.prototype.includesNull),
        opaqueDefault: shapes.some(shape => shape.prototype.opaqueDefault),
      };
      result.set(id, { kind: shapes[0]!.kind, length, properties, prototype });
    }
    return result;
  }
  function joinStates(template: State, paths: State[]): State {
    if (!paths.length) return { env: cloneEnv(template.env), heap: cloneHeap(template.heap) };
    return { env: joinEnv(template.env, paths.map(p => p.env)), heap: joinHeaps(paths.map(p => p.heap)) };
  }
  function widen(base: State, paths: State[]): State { return joinStates(base, [base, ...paths]); }
  function sameValue(a: ValueInfo, b: ValueInfo): boolean {
    const ar=a.refs??[], br=b.refs??[];
    return a.types.length===b.types.length && a.types.every((t,i)=>t===b.types[i])
      && ar.length===br.length && ar.every((x,i)=>x===br[i]);
  }
  function sameEnv(a: Environment, b: Environment): boolean {
    if (a.size !== b.size) return false;
    for (const [id, v] of a) { const other=b.get(id); if (!other || !sameValue(v, other)) return false; }
    return true;
  }
  function sameHeap(a: Map<number, Shape>, b: Map<number, Shape>): boolean {
    if (a.size !== b.size) return false;
    for (const [id, x] of a) {
      const y=b.get(id);
      if (!y || x.kind!==y.kind || x.length!==y.length || x.properties.size!==y.properties.size
        || x.prototype.includesNull!==y.prototype.includesNull || x.prototype.opaqueDefault!==y.prototype.opaqueDefault
        || x.prototype.refs.length!==y.prototype.refs.length
        || x.prototype.refs.some((r,i)=>r!==y.prototype.refs[i])) return false;
      for (const [k,v] of x.properties) {
        const w=y.properties.get(k);
        if(!w || !sameValue(v.value,w.value) || v.writable!==w.writable
          || v.enumerable!==w.enumerable || v.configurable!==w.configurable) return false;
      }
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
    const value = f.env.get(b.id);
    if (!value) fail('E_TDZ', `Binding '${b.name}' is accessed before initialization.`, n.span);
    return value;
  }
  function addTypes(left: TypeSet, right: TypeSet): TypeSet {
    if (hasReference(left) || hasReference(right)) return ['Number', 'String'];
    if (exactly(left, 'String') || exactly(right, 'String')) return ['String'];
    return left.includes('String') || right.includes('String') ? ['Number', 'String'] : ['Number'];
  }
  function requireReference(value: SE, f: Flow, operation: string): readonly number[] {
    if (value.types.some(t => t !== 'Object' && t !== 'Array') || !value.refs?.length)
      fail('E_PROPERTY_RECEIVER', `${operation} requires a proven compiler-owned Object/Array receiver.`, value.span);
    for (const ref of value.refs) if (!f.heap.has(ref)) fail('E_PROPERTY_FLOW', 'Object identity escaped the analyzable heap.', value.span);
    return value.refs;
  }
  function defaultPrototypeMayContain(shape: Shape, property: string): boolean {
    return property === '__proto__' || objectPrototypeKeys.has(property)
      || (shape.kind === 'Array' && arrayPrototypeKeys.has(property));
  }
  function readFromShape(ref: number, property: string, f: Flow, span: Node['span'], seen: Set<number>): ValueInfo {
    if (seen.has(ref)) return fail('E_PROTOTYPE_CYCLE', 'Prototype cycle reached during property analysis.', span);
    const nextSeen = new Set(seen); nextSeen.add(ref);
    const shape = f.heap.get(ref)!;
    const own = shape.properties.get(property);
    if (own) return own.value;
    const values: ValueInfo[] = [];
    for (const prototypeRef of shape.prototype.refs)
      values.push(readFromShape(prototypeRef, property, f, span, nextSeen));
    if (shape.prototype.opaqueDefault) {
      if (defaultPrototypeMayContain(shape, property))
        fail('E_PROTOTYPE_PROPERTY', `Property '${property}' may resolve through an unmaterialized builtin prototype.`, span);
      values.push(UNDEFINED);
    }
    if (shape.prototype.includesNull) values.push(UNDEFINED);
    return values.length ? unionValue(...values) : UNDEFINED;
  }
  function ownRead(receiver: SE, property: string, f: Flow): ValueInfo {
    return unionValue(...requireReference(receiver, f, 'Property read')
      .map(ref => readFromShape(ref, property, f, receiver.span, new Set())));
  }
  function inheritedDescriptors(shape: Shape, property: string, f: Flow, span: Node['span'], seen: Set<number>): PropertyShape[] {
    const result: PropertyShape[] = [];
    for (const prototypeRef of shape.prototype.refs) {
      if (seen.has(prototypeRef)) fail('E_PROTOTYPE_CYCLE', 'Prototype cycle reached during property write analysis.', span);
      const nextSeen = new Set(seen); nextSeen.add(prototypeRef);
      const prototype = f.heap.get(prototypeRef)!;
      const own = prototype.properties.get(property);
      if (own) result.push(own);
      else result.push(...inheritedDescriptors(prototype, property, f, span, nextSeen));
    }
    if (shape.prototype.opaqueDefault && defaultPrototypeMayContain(shape, property))
      fail('E_PROTOTYPE_WRITE_UNMODELED', `Property '${property}' may resolve through an unmaterialized builtin prototype.`, span);
    return result;
  }
  function setOwn(receiver: SE, property: string, value: ValueInfo, f: Flow): void {
    const refs = requireReference(receiver, f, 'Property write');
    if (property === '__proto__') fail('E_PROTOTYPE_MUTATION', '__proto__ assignment is deferred; use Object.setPrototypeOf in the supported profile.', receiver.span);
    for (const ref of refs) {
      const shape = f.heap.get(ref)!;
      if (shape.kind === 'Array' && property === 'length')
        fail('E_ARRAY_LENGTH_WRITE', 'Direct Array length writes are deferred until full ArraySetLength semantics are implemented.', receiver.span);
      const own = shape.properties.get(property);
      if (own) {
        if (own.writable !== true)
          fail('E_PROPERTY_WRITE_NONWRITABLE', `Property '${property}' is not proven writable.`, receiver.span);
        own.value = value;
      } else {
        const inherited = inheritedDescriptors(shape, property, f, receiver.span, new Set([ref]));
        if (inherited.some(p => p.writable !== true))
          fail('E_PROPERTY_WRITE_NONWRITABLE', `Inherited property '${property}' is not proven writable.`, receiver.span);
        shape.properties.set(property, ordinaryProperty(value));
      }
      if (shape.kind === 'Array' && shape.length !== undefined && /^(?:0|[1-9]\d*)$/.test(property)) {
        const index = Number(property);
        if (Number.isSafeInteger(index) && index >= 0 && index <= 0xffff_fffe) shape.length = Math.max(shape.length, index + 1);
      }
    }
  }
  function prototypeFromValue(value: SE, f: Flow, operation: string): PrototypeShape {
    const allowed = value.types.every(type => type === 'Object' || type === 'Array' || type === 'Null');
    if (!allowed || (!value.types.includes('Null') && !value.refs?.length))
      fail('E_PROTOTYPE_VALUE', `${operation} requires an Object or null prototype.`, value.span);
    if (value.refs) for (const ref of value.refs)
      if (!f.heap.has(ref)) fail('E_PROPERTY_FLOW', 'Prototype identity escaped the analyzable heap.', value.span);
    return {
      refs: [...new Set(value.refs ?? [])].sort((a,b)=>a-b),
      includesNull: value.types.includes('Null'),
      opaqueDefault: false,
    };
  }
  function prototypeReaches(start: number, target: number, f: Flow, seen = new Set<number>()): boolean {
    if (start === target) return true;
    if (seen.has(start)) return false;
    seen.add(start);
    const shape = f.heap.get(start)!;
    return shape.prototype.refs.some(ref => prototypeReaches(ref, target, f, seen));
  }
  function setPrototype(receiver: SE, prototype: SE, f: Flow): void {
    const refs = requireReference(receiver, f, 'Object.setPrototypeOf');
    const next = prototypeFromValue(prototype, f, 'Object.setPrototypeOf');
    for (const ref of refs) {
      const shape = f.heap.get(ref)!;
      if (shape.kind !== 'Object')
        fail('E_ARRAY_PROTOTYPE_MUTATION', 'Array prototype mutation is deferred to the array/exotic-object lanes.', receiver.span);
      if (next.refs.some(prototypeRef => prototypeReaches(prototypeRef, ref, f)))
        fail('E_PROTOTYPE_CYCLE', 'Object.setPrototypeOf would create a prototype cycle.', prototype.span);
      shape.prototype = clonePrototype(next);
    }
  }
  function getPrototypeValue(receiver: SE, f: Flow): ValueInfo {
    const refs = requireReference(receiver, f, 'Object.getPrototypeOf');
    const prototypes = refs.map(ref => f.heap.get(ref)!.prototype);
    if (prototypes.some(p => p.opaqueDefault))
      fail('E_PROTOTYPE_UNMODELED', 'The builtin Object/Array prototype is intentionally unmaterialized in this compiler profile.', receiver.span);
    const prototypeRefs = [...new Set(prototypes.flatMap(p => [...p.refs]))].sort((a,b)=>a-b);
    const typeSets: TypeSet[] = [];
    if (prototypeRefs.length)
      typeSets.push(union(...prototypeRefs.map(ref => [f.heap.get(ref)!.kind] as TypeSet)));
    if (prototypes.some(p => p.includesNull)) typeSets.push(['Null']);
    return { types: union(...typeSets), ...(prototypeRefs.length ? { refs: prototypeRefs } : {}) };
  }
  interface DataDescriptorSpec {
    hasValue: boolean; value: ValueInfo;
    writable?: boolean; enumerable?: boolean; configurable?: boolean;
  }
  function descriptorSpec(descriptor: SE): DataDescriptorSpec {
    if (descriptor.kind !== 'object')
      return fail('E_DESCRIPTOR_SHAPE', 'Object.defineProperty currently requires a direct ordinary object-literal descriptor.', descriptor.span);
    const fields = new Map(descriptor.properties.map(property => [property.key, property.value]));
    if (fields.has('get') || fields.has('set'))
      fail('E_ACCESSOR_FUNCTION_DEPENDENCY', 'Getter/setter descriptors require callable function values from the unmerged function runtime lane.', descriptor.span);
    const flag = (name: 'writable' | 'enumerable' | 'configurable'): boolean | undefined => {
      const field = fields.get(name);
      if (!field) return undefined;
      if (field.kind !== 'literal' || typeof field.value !== 'boolean')
        return fail('E_DESCRIPTOR_FLAG_PROOF', `Descriptor field '${name}' currently requires a Boolean literal for static invariant proof.`, field.span);
      return field.value;
    };
    const value = fields.get('value');
    return {
      hasValue: value !== undefined,
      value: value ? valueOf(value) : UNDEFINED,
      writable: flag('writable'),
      enumerable: flag('enumerable'),
      configurable: flag('configurable'),
    };
  }
  function applyDataDescriptor(receiver: SE, property: string, spec: DataDescriptorSpec, f: Flow): void {
    for (const ref of requireReference(receiver, f, 'Object.defineProperty')) {
      const shape = f.heap.get(ref)!;
      if (shape.kind !== 'Object')
        fail('E_ARRAY_DESCRIPTOR_UNSUPPORTED', 'Array descriptor mutation requires ArraySetLength/index invariants and is deferred.', receiver.span);
      const current = shape.properties.get(property);
      if (!current) {
        shape.properties.set(property, {
          value: spec.hasValue ? spec.value : UNDEFINED,
          writable: spec.writable ?? false,
          enumerable: spec.enumerable ?? false,
          configurable: spec.configurable ?? false,
        });
        continue;
      }
      if (current.writable === undefined || current.enumerable === undefined || current.configurable === undefined)
        fail('E_DESCRIPTOR_INVARIANT_UNPROVEN', 'Joined control flow made descriptor attributes ambiguous.', receiver.span);
      if (!current.configurable) {
        if (spec.configurable === true || (spec.enumerable !== undefined && spec.enumerable !== current.enumerable))
          fail('E_DESCRIPTOR_INCOMPATIBLE', 'Descriptor redefinition violates non-configurable property invariants.', receiver.span);
        if (!current.writable) {
          if (spec.writable === true) fail('E_DESCRIPTOR_INCOMPATIBLE', 'A non-configurable non-writable property cannot become writable.', receiver.span);
          if (spec.hasValue)
            fail('E_DESCRIPTOR_INVARIANT_UNPROVEN', 'SameValue proof for redefining a fixed data property is not available in this lane.', receiver.span);
        }
      }
      if (spec.hasValue) current.value = spec.value;
      if (spec.writable !== undefined) current.writable = spec.writable;
      if (spec.enumerable !== undefined) current.enumerable = spec.enumerable;
      if (spec.configurable !== undefined) current.configurable = spec.configurable;
    }
  }
  function ownDescriptor(receiver: SE, property: string, f: Flow): PropertyShape | undefined {
    const refs = requireReference(receiver, f, 'Object.getOwnPropertyDescriptor');
    if (refs.length !== 1)
      fail('E_DESCRIPTOR_ALIAS_UNPROVEN', 'Descriptor observation requires one proven receiver identity.', receiver.span);
    const shape = f.heap.get(refs[0]!)!;
    if (shape.kind !== 'Object')
      fail('E_ARRAY_DESCRIPTOR_UNSUPPORTED', 'Array descriptor observation is deferred to the array/exotic-object lanes.', receiver.span);
    return shape.properties.get(property);
  }
  function instantiate(b: Binding, args: SE[], callNode: Node): SemanticFunction {
    const fn = b.function!;
    if (args.length !== fn.params.length) fail('E_ARITY', 'Only exact-arity direct function calls are supported.', callNode.span);
    if (args.some(a => hasReference(a.types)))
      fail('E_OBJECT_FUNCTION_BOUNDARY', 'Object/Array arguments require alias/effect summaries and are deferred.', callNode.span);
    if (active.has(b.id)) fail('E_RECURSION', 'Recursive call graphs require a summary fixed point; unsupported in this MVP.', callNode.span);
    const key = `${b.id}:${args.map(a => a.types.join('|')).join(',')}`;
    const found = cache.get(key); if (found) return found;
    active.add(b.id);
    const instanceId = nextInstance++, params = fn.params.map(p => bindings.declarations.get(p.id)!);
    const f: Flow = { env: new Map(params.map((p, i) => [p.id, valueOf(args[i]!)])), heap: new Map(), reachable: true, returns: [], loopDepth: 0 };
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
        if (f.loopDepth) fail('E_OBJECT_LOOP_ALLOCATION', 'Object allocation inside loops requires per-iteration identity modeling and is deferred.', n.span);
        const ref = n.id, shape: Shape = { kind: 'Object', properties: new Map(), prototype: opaqueDefaultPrototype() };
        f.heap.set(ref, shape);
        const properties = n.properties.map(p => {
          const value = expression(p.value, f); shape.properties.set(p.key, ordinaryProperty(valueOf(value))); return { key: p.key, value };
        });
        return { ...n, kind: 'object', properties, types: ['Object'], refs: [ref] };
      }
      case 'array': {
        if (active.size) fail('E_OBJECT_FUNCTION_BOUNDARY', 'Array literals inside specialized functions require per-call heap summaries and are deferred.', n.span);
        if (f.loopDepth) fail('E_OBJECT_LOOP_ALLOCATION', 'Array allocation inside loops requires per-iteration identity modeling and is deferred.', n.span);
        const ref = n.id, shape: Shape = { kind: 'Array', length: n.elements.length, properties: new Map(), prototype: opaqueDefaultPrototype() };
        f.heap.set(ref, shape);
        const elements = n.elements.map((e, i) => {
          if (!e) return null;
          const value = expression(e, f); shape.properties.set(String(i), ordinaryProperty(valueOf(value))); return value;
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
          const value = expression(n.value, f); f.env.set(binding.id, valueOf(value));
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
        f.env.set(binding.id, { types });
        return { ...n, binding, leftTypes: left.types, value, types };
      }
      case 'update': {
        const binding = bindings.references.get(n.target.id)!;
        const operand = readType(binding, n.target, f), types: TypeSet = ['Number'];
        f.env.set(binding.id, { types });
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
                fail('E_CONSOLE_OBJECT', 'Object/Array console inspection is outside the primitive console host contract.', n.span);
              if (args.length > 1 && args[0]!.types.includes('String')) {
                const first = args[0]!;
                if (first.kind !== 'literal' || typeof first.value !== 'string' || first.value.includes('%'))
                  fail('E_CONSOLE_FORMAT', 'Multi-argument console.log with a possible format string needs Node util.format support.', n.span);
              }
              return { ...n, kind: 'call', target: 'console', binding, args, arity: args.length, types: ['Undefined'] };
            }
            if (binding?.kind === 'intrinsic' && binding.name === 'Object') {
              const staticKey = (key: Expr): string => {
                if (key.kind !== 'literal' || (typeof key.value !== 'string' && typeof key.value !== 'number'))
                  return fail('E_PROPERTY_KEY_COERCION', 'This Object operation currently requires a static String/Number key; general ToPropertyKey is deferred.', key.span);
                return typeof key.value === 'number' ? String(key.value) : key.value;
              };
              if (n.callee.property === 'hasOwn') {
                if (n.args.length !== 2) fail('E_ARITY', 'Object.hasOwn is supported only with exactly two arguments.', n.span);
                const receiver = expression(n.args[0]!, f); requireReference(receiver, f, 'Object.hasOwn');
                return { ...n, kind: 'call', target: 'object.hasOwn', binding, receiver,
                  property: staticKey(n.args[1]!), args: [], arity: 2, types: ['Boolean'] };
              }
              if (n.callee.property === 'create') {
                if (n.args.length === 2)
                  fail('E_OBJECT_CREATE_PROPERTIES', 'Object.create properties descriptors are deferred; define properties explicitly after creation.', n.span);
                if (n.args.length !== 1) fail('E_ARITY', 'Object.create is currently supported with exactly one prototype argument.', n.span);
                if (active.size) fail('E_OBJECT_FUNCTION_BOUNDARY', 'Object allocation inside specialized functions is deferred.', n.span);
                if (f.loopDepth) fail('E_OBJECT_LOOP_ALLOCATION', 'Object allocation inside loops requires per-iteration identity modeling and is deferred.', n.span);
                const prototype = expression(n.args[0]!, f);
                const prototypeShape = prototypeFromValue(prototype, f, 'Object.create');
                const ref = n.id;
                f.heap.set(ref, { kind: 'Object', properties: new Map(), prototype: clonePrototype(prototypeShape) });
                return { ...n, kind: 'call', target: 'object.create', binding, prototype, args: [prototype],
                  arity: 1, types: ['Object'], refs: [ref] };
              }
              if (n.callee.property === 'setPrototypeOf') {
                if (n.args.length !== 2) fail('E_ARITY', 'Object.setPrototypeOf is supported only with exactly two arguments.', n.span);
                const receiver = expression(n.args[0]!, f), prototype = expression(n.args[1]!, f);
                setPrototype(receiver, prototype, f);
                return withValue({ ...n, kind: 'call' as const, target: 'object.setPrototypeOf' as const,
                  binding, receiver, prototype, args: [receiver, prototype], arity: 2 }, valueOf(receiver));
              }
              if (n.callee.property === 'getPrototypeOf') {
                if (n.args.length !== 1) fail('E_ARITY', 'Object.getPrototypeOf is supported only with exactly one argument.', n.span);
                const receiver = expression(n.args[0]!, f), value = getPrototypeValue(receiver, f);
                return withValue({ ...n, kind: 'call' as const, target: 'object.getPrototypeOf' as const,
                  binding, receiver, args: [receiver], arity: 1 }, value);
              }
              if (n.callee.property === 'defineProperty') {
                if (n.args.length !== 3) fail('E_ARITY', 'Object.defineProperty is supported only with exactly three arguments.', n.span);
                const receiver = expression(n.args[0]!, f);
                const property = staticKey(n.args[1]!);
                const descriptor = expression(n.args[2]!, f);
                const spec = descriptorSpec(descriptor);
                applyDataDescriptor(receiver, property, spec, f);
                return withValue({ ...n, kind: 'call' as const, target: 'object.defineProperty' as const,
                  binding, receiver, property, descriptor, args: [receiver, descriptor], arity: 3 }, valueOf(receiver));
              }
              if (n.callee.property === 'getOwnPropertyDescriptor') {
                if (n.args.length !== 2) fail('E_ARITY', 'Object.getOwnPropertyDescriptor is supported only with exactly two arguments.', n.span);
                if (active.size) fail('E_OBJECT_FUNCTION_BOUNDARY', 'Descriptor object allocation inside specialized functions is deferred.', n.span);
                if (f.loopDepth) fail('E_OBJECT_LOOP_ALLOCATION', 'Descriptor object allocation inside loops requires per-iteration identity modeling and is deferred.', n.span);
                const receiver = expression(n.args[0]!, f), property = staticKey(n.args[1]!);
                const descriptor = ownDescriptor(receiver, property, f);
                if (!descriptor)
                  return { ...n, kind: 'call', target: 'object.getOwnPropertyDescriptor', binding, receiver,
                    property, args: [receiver], arity: 2, types: ['Undefined'] };
                if (descriptor.writable === undefined || descriptor.enumerable === undefined || descriptor.configurable === undefined)
                  fail('E_DESCRIPTOR_INVARIANT_UNPROVEN', 'Descriptor attributes are ambiguous after control-flow join.', n.span);
                const ref = n.id;
                f.heap.set(ref, { kind: 'Object', prototype: opaqueDefaultPrototype(), properties: new Map([
                  ['value', ordinaryProperty(descriptor.value)],
                  ['writable', ordinaryProperty({ types: ['Boolean'] })],
                  ['enumerable', ordinaryProperty({ types: ['Boolean'] })],
                  ['configurable', ordinaryProperty({ types: ['Boolean'] })],
                ]) });
                return { ...n, kind: 'call', target: 'object.getOwnPropertyDescriptor', binding, receiver,
                  property, args: [receiver], arity: 2, types: ['Object'], refs: [ref] };
              }
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
                for (const arg of args) shape.properties.set(String(index++), ordinaryProperty(valueOf(arg)));
                shape.length = index;
              }
            }
            return { ...n, kind: 'call', target: 'array.push', receiver, args, arity: args.length, types: ['Number'] };
          }
          fail('E_INDIRECT_CALL', `Member call '.${n.callee.property}' is not a proven supported intrinsic.`, n.span);
        }
        if (n.callee.kind !== 'identifier') fail('E_INDIRECT_CALL', 'Only statically resolved direct calls are supported.', n.span);
        const binding = bindings.references.get(n.callee.id)!;
        if (binding.kind === 'intrinsic') {
          if (!['isFinite', 'isNaN', 'parseFloat', 'parseInt'].includes(binding.name))
            fail('E_INDIRECT_CALL', `Calling '${binding.name}' requires callable runtime support.`, n.span);
          const target = binding.name as 'isFinite' | 'isNaN' | 'parseFloat' | 'parseInt';
          const args = n.args.map(a => expression(a, f));
          const validArity = target === 'parseInt' ? args.length === 1 || args.length === 2 : args.length === 1;
          if (!validArity) fail('E_ARITY', `Intrinsic ${target} is currently supported only at its reviewed arity.`, n.span);
          return { ...n, kind: 'call', binding, target, args, arity: args.length,
            types: target === 'isFinite' || target === 'isNaN' ? ['Boolean'] : ['Number'] };
        }
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
        f.env.set(binding.id, valueOf(initializer)); return { ...n, binding, initializer };
      }
      case 'expression': return { ...n, expression: expression(n.expression, f) };
      case 'block': return { ...n, body: statements(n.body, f, loop) };
      case 'return': {
        const value = n.value ? expression(n.value, f) : syntheticUndefined(n);
        if (hasReference(value.types)) fail('E_OBJECT_FUNCTION_BOUNDARY', 'Returning Object/Array values from specialized functions is deferred.', n.span);
        f.returns.push(value.types); f.reachable = false; return { ...n, value };
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
        const a: Flow = { env: cloneEnv(f.env), heap: cloneHeap(f.heap), reachable: true, returns: [], loopDepth: f.loopDepth };
        const b: Flow = { env: cloneEnv(f.env), heap: cloneHeap(f.heap), reachable: true, returns: [], loopDepth: f.loopDepth };
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
          const iter: Flow = { env: cloneEnv(state.env), heap: cloneHeap(state.heap), reachable: true, returns: [], loopDepth: f.loopDepth + 1 };
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
          const iter:Flow={env:cloneEnv(state.env),heap:cloneHeap(state.heap),reachable:true,returns:[],loopDepth:f.loopDepth+1};
          const control:LoopControl={breaks:[],continues:[]};
          const body=statement(n.body,iter,control)??emptyStatement(n.body);
          const backs=[...(iter.reachable?[stateOf(iter)]:[]),...control.continues];
          let condition:SE, conditionExit:State|undefined, back:State|undefined;
          if(backs.length){
            const testState=joinStates(state,backs);
            const test:Flow={env:cloneEnv(testState.env),heap:cloneHeap(testState.heap),reachable:true,returns:[],loopDepth:f.loopDepth+1};
            condition=expression(n.condition,test); conditionExit=stateOf(test); back=stateOf(test);
          } else {
            const unreachable:Flow={env:cloneEnv(state.env),heap:cloneHeap(state.heap),reachable:true,returns:[],loopDepth:f.loopDepth+1};
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
          const iter:Flow={env:cloneEnv(state.env),heap:cloneHeap(state.heap),reachable:true,returns:[],loopDepth:f.loopDepth+1};
          let condition:SE|undefined,conditionExit:State|undefined;
          if(n.condition){condition=expression(n.condition,iter);conditionExit=stateOf(iter)}
          const control:LoopControl={breaks:[],continues:[]};
          const body=statement(n.body,iter,control)??emptyStatement(n.body);
          const backs=[...(iter.reachable?[stateOf(iter)]:[]),...control.continues];
          let update:SE|undefined,back:State|undefined;
          if(backs.length){
            const updateState=joinStates(state,backs);
            const updateFlow:Flow={env:cloneEnv(updateState.env),heap:cloneHeap(updateState.heap),reachable:true,returns:[],loopDepth:f.loopDepth+1};
            if(n.update)update=expression(n.update,updateFlow);
            back=stateOf(updateFlow);
          }else if(n.update){
            const unreachable:Flow={env:cloneEnv(state.env),heap:cloneHeap(state.heap),reachable:true,returns:[],loopDepth:f.loopDepth+1};
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

  return { body: statements(program.body, { env: new Map(), heap: new Map(), reachable: true, returns: [], loopDepth: 0 }), functions: instances };
}
