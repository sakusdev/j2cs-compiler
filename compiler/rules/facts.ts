import type { Binding } from '../analysis/bindings.js';
import { Facts } from '../analysis/facts.js';
import type { SemanticExpr, SemanticFunction } from '../ir/semantic.js';
export function programFacts(): Facts {
  return new Facts()
    .prove('profile.host', 'Node.js', 'Explicit closed Node primitive-v1 compilation profile')
    .prove('profile.node', 'primitive-v1', 'Node primitive host contract')
    .prove('profile.platform', 'portable', 'No platform APIs admitted')
    .prove('intrinsics.integrity', 'pristine', 'Closed program: imports/eval/host escape/property writes are rejected')
    .prove('analysis.dynamicScope', false, 'Parser/binder reject eval, with and dynamic calls')
    .prove('analysis.bindings', 'resolved', 'Complete lexical predeclaration and binding resolution succeeded');
}
function bindingFacts(f: Facts, b: Binding): void {
  f.prove('binding.kind', b.kind, `Resolved binding #${b.id} (${b.name})`)
    .prove('binding.origin', b.kind === 'intrinsic' ? 'intrinsic' : 'declaration', 'Lexical binder provenance')
    .prove('binding.mutable', ['let', 'parameter'].includes(b.kind), 'Binder rejects writes to other binding kinds');
  if (b.kind === 'intrinsic') f.prove('binding.globalProperty', b.name, 'Unshadowed intrinsic resolution')
    .prove('binding.intrinsic', `%${b.name}%`, 'Intrinsic binding identity');
}
function functionFacts(f: Facts): void {
  f.prove('function.kind', 'ordinary', 'Parser admits only ordinary declarations')
    .prove('function.scope', 'module', 'Binder admits only top-level module-local functions')
    .prove('function.observes', [], 'Syntax/binding checks reject this, arguments, new.target, identity, properties, construction and escape')
    .prove('function.parameters', 'simple', 'Parser rejects default/rest/optional/destructured parameters');
}
export function expressionFacts(e: SemanticExpr): Facts {
  const f = programFacts().type('result', e.types, 'Flow-sensitive primitive type analysis')
    .prove('operands.domain', 'primitive', 'All admitted values are explicit Number/String/Boolean/Null/Undefined values');
  if (e.kind === 'literal') {
    f.prove('ast.kind', e.value === null ? 'NullLiteral' : 'Literal', 'Normalized AST literal');
    if (typeof e.value === 'number' && Object.is(e.value, -0)) f.prove('constant.value', '-0', 'Literal signed zero');
  }
  if (e.kind === 'binary') {
    f.type('left', e.left.types, 'Left operand analysis before evaluation of right operand')
      .type('right', e.right.types, 'Right operand analysis');
  }
  if (e.kind === 'unary') f.type('operand', e.operand.types, 'Unary operand analysis');
  if (e.kind === 'read' || e.kind === 'call' || e.kind === 'assign') bindingFacts(f, e.binding);
  if (e.kind === 'assign') f.prove('reference.kind', 'mutable-lexical', 'Resolved writable initialized local/parameter');
  if (e.kind === 'call') {
    if (e.target === 'console') f.prove('member.integrity', 'pristine', 'Only direct resolved console.log calls, no mutations/escape');
    else { functionFacts(f); f.prove('call.argumentCount', e.args.length, 'AST argument count')
      .prove('function.parameterCount', e.arity, 'Resolved declaration signature'); }
  }
  return f;
}
export function declarationFacts(fn: SemanticFunction): Facts {
  const f = programFacts(); functionFacts(f); bindingFacts(f, fn.binding); return f;
}
