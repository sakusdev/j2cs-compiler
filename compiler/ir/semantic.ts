import type { Binding } from '../analysis/bindings.js';
import type { TypeSet } from '../analysis/facts.js';
import type { Node, LiteralValue } from '../parser/ast.js';
export type RefSet = readonly number[];
export type AbruptKind = 'throw' | 'return' | 'break' | 'continue';
interface Typed { types: TypeSet; refs?: RefSet }
export type SemanticExpr = Node & Typed & (
  | { kind: 'literal'; value: LiteralValue | undefined }
  | { kind: 'read'; binding: Binding }
  | { kind: 'binary'; op: string; left: SemanticExpr; right: SemanticExpr }
  | { kind: 'unary'; op: string; operand: SemanticExpr }
  | { kind: 'assign'; binding: Binding; value: SemanticExpr }
  | { kind: 'propertyAssign'; object: SemanticExpr; property: string; value: SemanticExpr }
  | { kind: 'compound'; op: '+=' | '-=' | '*=' | '/=' | '%='; binding: Binding; leftTypes: TypeSet; value: SemanticExpr }
  | { kind: 'update'; op: '++' | '--'; prefix: boolean; binding: Binding; operandTypes: TypeSet }
  | { kind: 'member'; object: SemanticExpr; property: string }
  | { kind: 'object'; properties: { key: string; value: SemanticExpr }[] }
  | { kind: 'array'; elements: (SemanticExpr | null)[] }
  | { kind: 'call'; target: 'console' | 'isFinite' | 'isNaN' | 'parseFloat' | 'parseInt'; args: SemanticExpr[]; binding: Binding; arity: number }
  | { kind: 'call'; target: number; args: SemanticExpr[]; binding: Binding; arity: number; throwTypes: TypeSet }
  | { kind: 'call'; target: 'array.push'; receiver: SemanticExpr; args: SemanticExpr[]; arity: number }
  | { kind: 'call'; target: 'object.hasOwn'; receiver: SemanticExpr; property: string; binding: Binding; args: []; arity: 2 }
);
export type SemanticForInitializer = Node & (
  | { kind: 'variables'; declarations: (SemanticStatement & { kind: 'variable' })[] }
  | { kind: 'expression'; expression: SemanticExpr }
);
export interface SemanticCatchClause extends Node {
  binding?: Binding;
  body: SemanticStatement & { kind: 'block' };
}
export type SemanticStatement = Node & (
  | { kind: 'variable'; binding: Binding; initializer: SemanticExpr }
  | { kind: 'expression'; expression: SemanticExpr }
  | { kind: 'block'; body: SemanticStatement[] }
  | { kind: 'if'; condition: SemanticExpr; then: SemanticStatement; otherwise?: SemanticStatement }
  | { kind: 'while'; condition: SemanticExpr; body: SemanticStatement }
  | { kind: 'doWhile'; body: SemanticStatement; condition: SemanticExpr }
  | { kind: 'for'; initializer?: SemanticForInitializer; condition?: SemanticExpr; update?: SemanticExpr; body: SemanticStatement }
  | { kind: 'break' }
  | { kind: 'continue' }
  | { kind: 'return'; value: SemanticExpr }
  | { kind: 'throw'; value: SemanticExpr }
  | { kind: 'try'; body: SemanticStatement & { kind: 'block' }; catchClause?: SemanticCatchClause;
      finallyBlock?: SemanticStatement & { kind: 'block' }; pendingAbruptKinds: AbruptKind[];
      finallyAbruptKinds: AbruptKind[]; finallyCanCompleteNormally: boolean }
);
export interface SemanticFunction extends Node {
  instanceId: number;
  binding: Binding;
  params: Binding[];
  body: SemanticStatement[];
  returnTypes: TypeSet;
  throwTypes: TypeSet;
}
export interface SemanticProgram { body: SemanticStatement[]; functions: SemanticFunction[] }
