import type { Span } from '../diagnostics/index.js';
export interface Node { id: number; span: Span }
export type LiteralValue = number | string | boolean | null;
export type VariableStatement = Statement & { kind: 'variable' };
export type ForInitializer = Node & (
  | { kind: 'variables'; declarations: VariableStatement[] }
  | { kind: 'expression'; expression: Expr }
);
export type Expr = Node & (
  | { kind: 'literal'; value: LiteralValue }
  | { kind: 'identifier'; name: string }
  | { kind: 'binary'; op: string; left: Expr; right: Expr }
  | { kind: 'unary'; op: string; operand: Expr }
  | { kind: 'assign'; target: Expr & { kind: 'identifier' }; value: Expr }
  | { kind: 'compound'; op: '+=' | '-=' | '*=' | '/=' | '%='; target: Expr & { kind: 'identifier' }; value: Expr }
  | { kind: 'update'; op: '++' | '--'; prefix: boolean; target: Expr & { kind: 'identifier' } }
  | { kind: 'member'; object: Expr; property: string }
  | { kind: 'call'; callee: Expr; args: Expr[] }
);
export interface Parameter extends Node { name: string }
export type Statement = Node & (
  | { kind: 'variable'; mode: 'const' | 'let'; name: string; initializer?: Expr }
  | { kind: 'expression'; expression: Expr }
  | { kind: 'block'; body: Statement[] }
  | { kind: 'if'; condition: Expr; then: Statement; otherwise?: Statement }
  | { kind: 'while'; condition: Expr; body: Statement }
  | { kind: 'doWhile'; body: Statement; condition: Expr }
  | { kind: 'for'; initializer?: ForInitializer; condition?: Expr; update?: Expr; body: Statement }
  | { kind: 'break' }
  | { kind: 'continue' }
  | { kind: 'function'; name: string; params: Parameter[]; body: Statement & { kind: 'block' } }
  | { kind: 'return'; value?: Expr }
  | { kind: 'empty' }
);
export type FunctionDeclaration = Statement & { kind: 'function' };
export interface Program { file: string; body: Statement[] }
