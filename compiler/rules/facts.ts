import type { Binding } from '../analysis/bindings.js';
import { isPrimitiveSet, Facts } from '../analysis/facts.js';
import type { SemanticExpr, SemanticFunction } from '../ir/semantic.js';

export function programFacts(): Facts {
  return new Facts()
    .prove('profile.host', 'Node.js', 'Explicit closed Node compiler profile')
    .prove('profile.node', 'primitive-v1', 'Stable Node profile identifier retained for backwards-compatible primitive rule proofs')
    .prove('profile.platform', 'portable', 'No platform APIs admitted')
    .prove('intrinsics.integrity', 'pristine', 'Intrinsic roots cannot escape or be mutated; supported user object writes target compiler-owned objects only')
    .prove('intrinsics.arrayPrototypeIndexed', false, 'Prototype mutation/escape syntax is rejected in the closed profile')
    .prove('analysis.dynamicScope', false, 'Parser/binder reject eval, with and dynamic calls')
    .prove('analysis.bindings', 'resolved', 'Complete lexical predeclaration and binding resolution succeeded');
}
function bindingFacts(f: Facts, b: Binding): void {
  f.prove('binding.kind', b.kind, `Resolved binding #${b.id} (${b.name})`)
    .prove('binding.origin', b.kind === 'intrinsic' ? 'intrinsic' : 'declaration', 'Lexical binder provenance')
    .prove('binding.mutable', ['let', 'parameter'].includes(b.kind), 'Binder rejects writes to other binding kinds')
    .prove('binding.lexical', ['const', 'let', 'parameter'].includes(b.kind), 'Resolved lexical/parameter binding class')
    .prove('binding.perIteration', b.perIteration === true, 'Binder marks loop lexical bindings requiring fresh iteration cells');
  if (b.kind === 'intrinsic') f.prove('binding.globalProperty', b.name, 'Unshadowed intrinsic resolution')
    .prove('binding.intrinsic', `%${b.name}%`, 'Intrinsic binding identity');
}
function functionFacts(f: Facts, b?: Binding): void {
  f.prove('function.kind', 'ordinary', 'Parser admits ordinary function declarations/expressions only')
    .prove('function.scope', b?.owner === 0 ? 'module' : 'function', 'Resolved lexical declaration owner')
    .prove('function.observes', b?.observedAsValue ? ['identity'] : [],
      'this/arguments/new.target/properties/construction are rejected; identity is tracked explicitly')
    .prove('function.parameters', 'simple', 'Parser rejects default/rest/optional/destructured parameters')
    .prove('function.formalsKnown', true, 'Simple parameter list is fully resolved by the binder');
}
function receiverFacts(f: Facts, e: SemanticExpr): void {
  if (e.kind !== 'member' && !(e.kind === 'call' && (e.target === 'array.push' || e.target === 'object.hasOwn'))) return;
  const receiver = e.kind === 'member' ? e.object : e.receiver;
  f.type('receiver', receiver.types, 'Flow-sensitive receiver type and compiler-owned reference tracking')
    .prove('receiver.proxy', false, 'No Proxy construction or external object ingress is admitted')
    .prove('object.representation', 'JsObject', 'Compiler-owned Object/Array references use JsObject/JsArray runtime storage');
  if (receiver.types.length === 1 && receiver.types[0] === 'Array') {
    f.prove('receiver.representation', 'JsArray', 'Exact Array flow type maps to canonical JsArray representation')
      .prove('receiver.indexedDataOnly', true, 'Supported arrays contain ordinary indexed data properties/holes only');
  }
}
export function expressionFacts(e: SemanticExpr): Facts {
  const f = programFacts().type('result', e.types, 'Flow-sensitive JavaScript value type analysis')
    .prove('operands.complete', true, 'Every admitted runtime value has an explicit JsValue tag/reference representation');

  if (e.kind === 'binary') {
    f.type('left', e.left.types, 'Left operand analysis before evaluation of right operand')
      .type('right', e.right.types, 'Right operand analysis')
      .prove('operands.domain', isPrimitiveSet(e.left.types) && isPrimitiveSet(e.right.types) ? 'primitive' : 'ecmascript-value',
        'Complete operand type sets determine whether ToPrimitive can be skipped');
    if (e.op === '==' || e.op === '!=')
      f.prove('operator.semantic', e.op === '==' ? 'abstract equality' : 'abstract inequality', 'Normalized operator semantics');
  } else if (e.kind === 'compound') {
    f.type('left', e.leftTypes, 'Compound assignment GetValue before RHS evaluation')
      .type('right', e.value.types, 'Compound assignment RHS analysis')
      .prove('operands.domain', isPrimitiveSet(e.leftTypes) && isPrimitiveSet(e.value.types) ? 'primitive' : 'ecmascript-value',
        'Compound operand type sets determine whether ToPrimitive can be skipped');
  } else if (e.kind === 'unary') {
    f.type('operand', e.operand.types, 'Unary operand analysis')
      .prove('operands.domain', isPrimitiveSet(e.operand.types) ? 'primitive' : 'ecmascript-value', 'Complete unary operand type set')
      .prove('operand.domain', isPrimitiveSet(e.operand.types) ? 'primitive' : 'ecmascript-value', 'Complete unary operand type set');
  } else if (e.kind === 'update') {
    f.type('operand', e.operandTypes, 'Update operand GetValue analysis')
      .prove('operands.domain', isPrimitiveSet(e.operandTypes) ? 'primitive' : 'ecmascript-value', 'Complete update operand type set');
  } else {
    f.prove('operands.domain', isPrimitiveSet(e.types) ? 'primitive' : 'ecmascript-value', 'Result type domain');
  }

  if (e.kind === 'literal') {
    f.prove('ast.kind', e.value === null ? 'NullLiteral' : 'Literal', 'Normalized AST literal');
    if (typeof e.value === 'number' && Object.is(e.value, -0)) f.prove('constant.value', '-0', 'Literal signed zero');
  }
  if (e.kind === 'read' || e.kind === 'assign' || e.kind === 'compound' || e.kind === 'update' || (e.kind === 'call' && 'binding' in e))
    bindingFacts(f, e.binding);
  if (e.kind === 'assign' || e.kind === 'compound' || e.kind === 'update')
    f.prove('reference.kind', 'mutable-lexical', 'Resolved writable initialized local/parameter');
  if (e.kind === 'call') {
    if (e.target === 'console') f.prove('member.integrity', 'pristine', 'Only direct resolved console.log calls, no intrinsic mutation/escape');
    else if (e.target === 'array.push') f.prove('member.integrity', 'pristine', 'Receiver has no own push property and Array prototype is pristine');
    else if (e.target === 'object.hasOwn') f.prove('member.integrity', 'pristine', 'Direct unshadowed Object.hasOwn with static key')
      .prove('object.ownPropertyTest', true, 'JsObject/JsArray explicitly preserve own-property presence separately from undefined');
    else if (typeof e.target === 'number') {
      functionFacts(f, e.binding); f.prove('call.argumentCount', e.args.length, 'AST argument count')
        .prove('function.parameterCount', e.arity, 'Resolved declaration signature')
        .prove('call.fewerThanFormals', e.args.length < e.arity, 'Resolved source argument count vs formal count')
        .prove('call.moreThanFormals', e.args.length > e.arity, 'Resolved source argument count vs formal count');
    } else {
      f.prove('call.argumentCount', e.args.length, 'AST intrinsic argument count');
      const argument = e.args[0];
      if (argument) f.type('argument', argument.types, 'Resolved first intrinsic argument type set')
        .type('value', argument.types, 'Resolved first intrinsic argument type set')
        .prove('argument.domain', isPrimitiveSet(argument.types) ? 'primitive' : 'ecmascript-value', 'Complete intrinsic argument domain')
        .prove('value.domain', isPrimitiveSet(argument.types) ? 'primitive' : 'ecmascript-value', 'Complete intrinsic argument domain');
      if (e.target === 'parseInt') {
        f.prove('call.radixOmitted', e.args.length === 1, 'parseInt source arity');
        const radix = e.args[1];
        if (radix) f.type('radix', radix.types, 'Resolved parseInt radix type set')
          .prove('radix.domain', isPrimitiveSet(radix.types) ? 'primitive' : 'ecmascript-value', 'Complete parseInt radix domain');
      }
    }
  }
  receiverFacts(f, e);
  return f;
}
export function declarationFacts(fn: SemanticFunction): Facts {
  const f = programFacts(); functionFacts(f, fn.binding); bindingFacts(f, fn.binding); return f;
}

export function captureFacts(binding: Binding): Facts {
  const f = programFacts(); bindingFacts(f, binding); return f;
}
