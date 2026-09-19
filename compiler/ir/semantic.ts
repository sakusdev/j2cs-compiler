import type { Binding } from '../analysis/bindings.js';
import type { TypeSet } from '../analysis/facts.js';
import type { Node, LiteralValue } from '../parser/ast.js';
export type RefSet = readonly number[];
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
  | { kind: 'spread'; operand: SemanticExpr }
  | { kind: 'argumentsLength'; binding: Binding }
  | { kind: 'argumentsIndex'; binding: Binding; index: number }
  | { kind: 'call'; target: 'console' | 'isFinite' | 'isNaN' | 'parseFloat' | 'parseInt' | number; args: SemanticExpr[]; binding: Binding; arity: number;
      suppliedCount?: number; callKind?: 'exact' | 'missing' | 'extra' | 'spread' | 'nonSimpleExact';
      functionSimple?: boolean; observesArguments?: boolean }
  | { kind: 'call'; target: 'array.push'; receiver: SemanticExpr; args: SemanticExpr[]; arity: number }
  | { kind: 'call'; target: 'object.hasOwn'; receiver: SemanticExpr; property: string; binding: Binding; args: []; arity: 2 }
);
export type SemanticForInitializer = Node & (
  | { kind: 'variables'; declarations: (SemanticStatement & { kind: 'variable' })[] }
  | { kind: 'expression'; expression: SemanticExpr }
);
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
);
export interface SemanticParameter {
  binding: Binding; index: number; rest: boolean; hasDefault: boolean;
  initialization: 'argument' | 'default-always' | 'default-conditional' | 'rest';
  initializer?: SemanticExpr;
}
export interface SemanticFunction extends Node {
  instanceId: number; binding: Binding; argumentsBinding: Binding; params: SemanticParameter[];
  body: SemanticStatement[]; returnTypes: TypeSet; simpleParameters: boolean; observesArguments: boolean;
}
export interface SemanticProgram { body: SemanticStatement[]; functions: SemanticFunction[] }
