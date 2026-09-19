import type { Span } from '../diagnostics/index.js';
export interface Node { id: number; span: Span }
export type LiteralValue = number | string | boolean | null;
export type Expr = Node & (
  | { kind: 'literal'; value: LiteralValue }
  | { kind: 'identifier'; name: string }
  | { kind: 'binary'; op: string; left: Expr; right: Expr }
  | { kind: 'unary'; op: string; operand: Expr }
  | { kind: 'assign'; target: Expr & { kind: 'identifier' }; value: Expr }
  | { kind: 'member'; object: Expr; property: string }
  | { kind: 'call'; callee: Expr; args: Expr[] }
);
export interface Parameter extends Node { name: string }
export type Statement = Node & (
  | { kind: 'variable'; mode: 'const' | 'let'; name: string; initializer?: Expr }
  | { kind: 'expression'; expression: Expr }
  | { kind: 'block'; body: Statement[] }
  | { kind: 'if'; condition: Expr; then: Statement; otherwise?: Statement }
  | { kind: 'function'; name: string; params: Parameter[]; body: Statement & { kind: 'block' } }
  | { kind: 'return'; value?: Expr }
  | { kind: 'empty' }
);
export type FunctionDeclaration = Statement & { kind: 'function' };
export interface Program { file: string; body: Statement[] }
