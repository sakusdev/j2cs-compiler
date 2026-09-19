import { fail } from '../diagnostics/index.js';
import type { Expr, FunctionDeclaration, FunctionNode, Node, Program, Statement } from '../parser/ast.js';

export interface Binding {
  id: number; name: string; kind: 'const' | 'let' | 'parameter' | 'function' | 'intrinsic';
  owner: number; declaration?: Node; function?: FunctionNode;
  observedAsValue?: boolean; perIteration?: boolean;
}
export interface Bindings {
  references: Map<number, Binding>;
  declarations: Map<number, Binding>;
  functions: Binding[];
  captures: Map<number, Binding[]>;
  capturedIds: Set<number>;
}
interface Scope { parent?: Scope; owner: number; names: Map<string, Binding> }
type ScopeKind = 'program' | 'function' | 'block';

const intrinsics = ['undefined', 'NaN', 'Infinity', 'console', 'Object', 'isFinite', 'isNaN', 'parseFloat', 'parseInt'];
const callableIntrinsics = new Set(['isFinite', 'isNaN', 'parseFloat', 'parseInt']);

export function resolveBindings(program: Program): Bindings {
  let nextId = 0;
  const references = new Map<number, Binding>();
  const declarations = new Map<number, Binding>();
  const functions: Binding[] = [];
  const captures = new Map<number, Binding[]>();
  const capturedIds = new Set<number>();
  const global: Scope = { owner: -1, names: new Map() };
  for (const name of intrinsics) global.names.set(name, { id: nextId++, name, kind: 'intrinsic', owner: -1 });

  function declare(scope: Scope, n: Node, name: string, kind: Binding['kind'], fn?: FunctionNode, perIteration = false): Binding {
    if (['eval', 'arguments'].includes(name))
      fail('E_RESERVED_BINDING', `Binding '${name}' requires semantics outside this profile.`, n.span);
    if (scope.names.has(name)) fail('E_DUPLICATE_BINDING', `Duplicate binding '${name}'.`, n.span);
    const b: Binding = { id: nextId++, name, kind, owner: scope.owner, declaration: n, function: fn, perIteration };
    scope.names.set(name, b); declarations.set(n.id, b);
    if (fn) functions.push(b);
    return b;
  }

  function functionExpression(n: Expr & { kind: 'functionExpr' }, scope: Scope): Binding {
    const found = declarations.get(n.id);
    if (found) return found;
    const b: Binding = {
      id: nextId++, name: `<anonymous@${n.id}>`, kind: 'function', owner: scope.owner,
      declaration: n, function: n,
    };
    declarations.set(n.id, b); functions.push(b); return b;
  }

  function noteCapture(owner: number, b: Binding, n: Node): void {
    if (b.kind === 'intrinsic' || b.owner === owner) return;
    if (b.perIteration)
      fail('E_PER_ITERATION_CLOSURE',
        `Capture of '${b.name}' requires a fresh lexical cell for each loop iteration.`, n.span);
    capturedIds.add(b.id);
    const list = captures.get(owner) ?? [];
    if (!list.some(x => x.id === b.id)) captures.set(owner, [...list, b]);
  }

  function resolve(n: Expr & { kind: 'identifier' }, scope: Scope, use: 'value' | 'callee' | 'receiver'): Binding {
    let s: Scope | undefined = scope, b: Binding | undefined;
    while (s && !(b = s.names.get(n.name))) s = s.parent;
    if (!b) {
      if (n.name === 'arguments')
        fail('E_ARGUMENTS_UNSUPPORTED', 'arguments requires an arguments-object representation and is not implemented.', n.span);
      fail('E_UNRESOLVED_BINDING', `Unresolved identifier '${n.name}'.`, n.span);
    }
    noteCapture(scope.owner, b, n);
    if (b.kind === 'function' && use !== 'callee') b.observedAsValue = true;
    references.set(n.id, b); return b;
  }

  function writable(n: Expr & { kind: 'identifier' }, scope: Scope, span: Node['span']): Binding {
    const b = resolve(n, scope, 'value');
    if (b.kind !== 'let' && b.kind !== 'parameter')
      fail('E_IMMUTABLE_WRITE', `Assignment to '${b.name}' is unsupported (${b.kind}).`, span);
    return b;
  }

  function expr(n: Expr, s: Scope, loopDepth: number, use: 'value' | 'callee' | 'receiver' = 'value'): void {
    switch (n.kind) {
      case 'literal': return;
      case 'identifier': {
        const b = resolve(n, s, use);
        if (b.kind === 'intrinsic' && ['console', 'Object'].includes(b.name) && use !== 'receiver')
          fail('E_INTRINSIC_ESCAPE', `${b.name} may only be used as the direct receiver of a supported intrinsic call.`, n.span);
        if (b.kind === 'intrinsic' && callableIntrinsics.has(b.name) && use !== 'callee')
          fail('E_INTRINSIC_ESCAPE', `${b.name} may only be used as a direct intrinsic call.`, n.span);
        return;
      }
      case 'functionExpr': {
        const b = functionExpression(n, s);
        const fs: Scope = { parent: s, owner: n.id + 1, names: new Map() };
        for (const p of n.params) declare(fs, p, p.name, 'parameter');
        body(n.body.body, fs, 'function', 0);
        // Keep the synthetic template alive for lowering even though it has no lexical name.
        void b;
        return;
      }
      case 'object': n.properties.forEach(p => expr(p.value, s, loopDepth)); return;
      case 'array': n.elements.forEach(e => { if (e) expr(e, s, loopDepth); }); return;
      case 'binary': expr(n.left, s, loopDepth); expr(n.right, s, loopDepth); return;
      case 'unary': expr(n.operand, s, loopDepth); return;
      case 'assign': {
        if (n.target.kind === 'identifier') writable(n.target, s, n.span);
        else {
          expr(n.target.object, s, loopDepth, 'receiver');
          if (n.target.object.kind === 'identifier') {
            const b = references.get(n.target.object.id)!;
            if (b.kind === 'intrinsic')
              fail('E_INTRINSIC_MUTATION', `Mutation of intrinsic '${b.name}' is outside the closed profile.`, n.span);
          }
        }
        expr(n.value, s, loopDepth); return;
      }
      case 'compound': writable(n.target, s, n.span); expr(n.value, s, loopDepth); return;
      case 'update': writable(n.target, s, n.span); return;
      case 'member': expr(n.object, s, loopDepth, 'receiver'); return;
      case 'call': expr(n.callee, s, loopDepth, 'callee'); n.args.forEach(a => expr(a, s, loopDepth)); return;
    }
  }

  function body(nodes: Statement[], s: Scope, scopeKind: ScopeKind, loopDepth = 0): void {
    for (const n of nodes) {
      if (n.kind === 'variable') declare(s, n, n.name, n.mode, undefined, loopDepth > 0);
      if (n.kind === 'function') {
        if (scopeKind === 'block')
          fail('E_BLOCK_FUNCTION', 'Block-level function declarations require Annex B/module environment semantics.', n.span);
        declare(s, n, n.name, 'function', n);
      }
    }
    for (const n of nodes) visit(n, s, loopDepth);
  }

  function visit(n: Statement, s: Scope, loopDepth: number): void {
    switch (n.kind) {
      case 'variable': if (n.initializer) expr(n.initializer, s, loopDepth); return;
      case 'expression': expr(n.expression, s, loopDepth); return;
      case 'block': body(n.body, { parent: s, owner: s.owner, names: new Map() }, 'block', loopDepth); return;
      case 'if':
        expr(n.condition, s, loopDepth); visit(n.then, s, loopDepth);
        if (n.otherwise) visit(n.otherwise, s, loopDepth); return;
      case 'while': expr(n.condition, s, loopDepth); visit(n.body, s, loopDepth + 1); return;
      case 'doWhile': visit(n.body, s, loopDepth + 1); expr(n.condition, s, loopDepth); return;
      case 'for': {
        let loopScope = s;
        if (n.initializer?.kind === 'variables') {
          loopScope = { parent: s, owner: s.owner, names: new Map() };
          for (const d of n.initializer.declarations) declare(loopScope, d, d.name, d.mode, undefined, true);
          for (const d of n.initializer.declarations) if (d.initializer) expr(d.initializer, loopScope, loopDepth + 1);
        } else if (n.initializer?.kind === 'expression') expr(n.initializer.expression, s, loopDepth);
        if (n.condition) expr(n.condition, loopScope, loopDepth);
        if (n.update) expr(n.update, loopScope, loopDepth);
        visit(n.body, loopScope, loopDepth + 1);
        return;
      }
      case 'break':
        if (!loopDepth) fail('E_BREAK_CONTEXT', 'break outside a loop is unsupported.', n.span); return;
      case 'continue':
        if (!loopDepth) fail('E_CONTINUE_CONTEXT', 'continue outside a loop is unsupported.', n.span); return;
      case 'return':
        if (s.owner === 0) fail('E_RETURN_CONTEXT', 'return outside a function is unsupported.', n.span);
        if (n.value) expr(n.value, s, loopDepth); return;
      case 'function': {
        const fs: Scope = { parent: s, owner: n.id + 1, names: new Map() };
        for (const p of n.params) declare(fs, p, p.name, 'parameter');
        body(n.body.body, fs, 'function', 0); return;
      }
      case 'empty': return;
    }
  }

  body(program.body, { parent: global, owner: 0, names: new Map() }, 'program', 0);
  return { references, declarations, functions, captures, capturedIds };
}
