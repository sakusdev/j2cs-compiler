import { fail } from '../diagnostics/index.js';
import type { Expr, FunctionDeclaration, Node, Program, Statement } from '../parser/ast.js';
export interface Binding {
  id: number; name: string; kind: 'const' | 'let' | 'parameter' | 'function' | 'intrinsic';
  owner: number; declaration?: Node; function?: FunctionDeclaration;
}
export interface Bindings {
  references: Map<number, Binding>; declarations: Map<number, Binding>; functions: Binding[];
}
interface Scope { parent?: Scope; owner: number; names: Map<string, Binding> }
const intrinsics = ['undefined', 'NaN', 'Infinity', 'console'];
export function resolveBindings(program: Program): Bindings {
  let nextId = 0;
  const references = new Map<number, Binding>(), declarations = new Map<number, Binding>(), functions: Binding[] = [];
  const global: Scope = { owner: -1, names: new Map() };
  for (const name of intrinsics) global.names.set(name, { id: nextId++, name, kind: 'intrinsic', owner: -1 });
  function declare(scope: Scope, n: Node, name: string, kind: Binding['kind'], fn?: FunctionDeclaration): Binding {
    if (['eval', 'arguments'].includes(name)) fail('E_RESERVED_BINDING', `Binding '${name}' requires semantics outside this profile.`, n.span);
    if (scope.names.has(name)) fail('E_DUPLICATE_BINDING', `Duplicate binding '${name}'.`, n.span);
    const b: Binding = { id: nextId++, name, kind, owner: scope.owner, declaration: n, function: fn };
    scope.names.set(name, b); declarations.set(n.id, b);
    if (fn) functions.push(b);
    return b;
  }
  function resolve(n: Expr & { kind: 'identifier' }, scope: Scope): Binding {
    let s: Scope | undefined = scope, b: Binding | undefined;
    while (s && !(b = s.names.get(n.name))) s = s.parent;
    if (!b) fail('E_UNRESOLVED_BINDING', `Unresolved identifier '${n.name}'.`, n.span);
    if (b.owner !== scope.owner && b.kind !== 'function' && b.kind !== 'intrinsic')
      fail('E_CAPTURE', `Capture of '${n.name}' needs closure/TDZ analysis, which is not implemented.`, n.span);
    references.set(n.id, b); return b;
  }
  function writable(n: Expr & { kind: 'identifier' }, scope: Scope, span: Node['span']): Binding {
    const b = resolve(n, scope);
    if (b.kind !== 'let' && b.kind !== 'parameter') fail('E_IMMUTABLE_WRITE', `Assignment to '${b.name}' is unsupported (${b.kind}).`, span);
    return b;
  }
  function expr(n: Expr, s: Scope, use: 'value' | 'callee' | 'receiver' = 'value'): void {
    switch (n.kind) {
      case 'literal': return;
      case 'identifier': {
        const b = resolve(n, s);
        if (b.kind === 'function' && use !== 'callee') fail('E_FUNCTION_VALUE', 'Function identity/escape is unsupported; use a direct call.', n.span);
        if (b.kind === 'intrinsic' && b.name === 'console' && use !== 'receiver') fail('E_INTRINSIC_ESCAPE', 'console may only be used as the direct receiver of console.log.', n.span);
        return;
      }
      case 'binary': expr(n.left, s); expr(n.right, s); return;
      case 'unary': expr(n.operand, s); return;
      case 'assign': writable(n.target, s, n.span); expr(n.value, s); return;
      case 'compound': writable(n.target, s, n.span); expr(n.value, s); return;
      case 'update': writable(n.target, s, n.span); return;
      case 'member':
        if (use !== 'callee' || n.property !== 'log' || n.object.kind !== 'identifier')
          fail('E_MEMBER', 'Only direct console.log member calls are supported.', n.span);
        expr(n.object, s, 'receiver'); return;
      case 'call': expr(n.callee, s, 'callee'); n.args.forEach(a => expr(a, s)); return;
    }
  }
  function body(nodes: Statement[], s: Scope, top = false, loopDepth = 0): void {
    for (const n of nodes) {
      if (n.kind === 'variable') declare(s, n, n.name, n.mode);
      if (n.kind === 'function') {
        if (!top) fail('E_NESTED_FUNCTION', 'Nested/block functions need closure or Annex B semantics.', n.span);
        declare(s, n, n.name, 'function', n);
      }
    }
    for (const n of nodes) visit(n, s, loopDepth);
  }
  function visit(n: Statement, s: Scope, loopDepth: number): void {
    switch (n.kind) {
      case 'variable': if (n.initializer) expr(n.initializer, s); return;
      case 'expression': expr(n.expression, s); return;
      case 'block': body(n.body, { parent: s, owner: s.owner, names: new Map() }, false, loopDepth); return;
      case 'if': expr(n.condition, s); visit(n.then, s, loopDepth); if (n.otherwise) visit(n.otherwise, s, loopDepth); return;
      case 'while': expr(n.condition, s); visit(n.body, s, loopDepth + 1); return;
      case 'doWhile': visit(n.body, s, loopDepth + 1); expr(n.condition, s); return;
      case 'for': {
        let loopScope = s;
        if (n.initializer?.kind === 'variables') {
          loopScope = { parent: s, owner: s.owner, names: new Map() };
          for (const d of n.initializer.declarations) declare(loopScope, d, d.name, d.mode);
          for (const d of n.initializer.declarations) if (d.initializer) expr(d.initializer, loopScope);
        } else if (n.initializer?.kind === 'expression') expr(n.initializer.expression, s);
        if (n.condition) expr(n.condition, loopScope);
        if (n.update) expr(n.update, loopScope);
        visit(n.body, loopScope, loopDepth + 1);
        return;
      }
      case 'break': if (!loopDepth) fail('E_BREAK_CONTEXT', 'break outside a loop is unsupported.', n.span); return;
      case 'continue': if (!loopDepth) fail('E_CONTINUE_CONTEXT', 'continue outside a loop is unsupported.', n.span); return;
      case 'return':
        if (s.owner === 0) fail('E_RETURN_CONTEXT', 'return outside a function is unsupported.', n.span);
        if (n.value) expr(n.value, s); return;
      case 'function': {
        const fs: Scope = { parent: s, owner: n.id + 1, names: new Map() };
        for (const p of n.params) declare(fs, p, p.name, 'parameter');
        body(n.body.body, fs, false, 0); return;
      }
      case 'empty': return;
    }
  }
  body(program.body, { parent: global, owner: 0, names: new Map() }, true, 0);
  return { references, declarations, functions };
}
