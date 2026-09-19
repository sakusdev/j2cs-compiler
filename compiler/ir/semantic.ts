import type { Binding } from '../analysis/bindings.js';
import type { TypeSet } from '../analysis/facts.js';
import type { Node, LiteralValue } from '../parser/ast.js';
export type SemanticExpr = Node & { types: TypeSet } & (
  | { kind: 'literal'; value: LiteralValue | undefined }
  | { kind: 'read'; binding: Binding }
  | { kind: 'binary'; op: string; left: SemanticExpr; right: SemanticExpr }
  | { kind: 'unary'; op: string; operand: SemanticExpr }
  | { kind: 'assign'; binding: Binding; value: SemanticExpr }
  | { kind: 'call'; target: 'console' | number; args: SemanticExpr[]; binding: Binding; arity: number }
);
export type SemanticStatement = Node & (
  | { kind: 'variable'; binding: Binding; initializer: SemanticExpr }
  | { kind: 'expression'; expression: SemanticExpr }
  | { kind: 'block'; body: SemanticStatement[] }
  | { kind: 'if'; condition: SemanticExpr; then: SemanticStatement; otherwise?: SemanticStatement }
  | { kind: 'return'; value: SemanticExpr }
);
export interface SemanticFunction extends Node {
  instanceId: number; binding: Binding; params: Binding[]; body: SemanticStatement[]; returnTypes: TypeSet;
}
export interface SemanticProgram { body: SemanticStatement[]; functions: SemanticFunction[] }
