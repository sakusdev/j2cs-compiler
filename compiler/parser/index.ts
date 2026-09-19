import ts from 'typescript';
import { Script } from 'node:vm';
import { fail } from '../diagnostics/index.js';
import type { Expr, Node, Program, Statement } from './ast.js';

/** The only compiler module that knows TypeScript's AST. Annotations are erased, never proofs. */
export function parse(source: string, file = 'input.js'): Program {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  let nextId = 0;
  function meta(n: ts.Node): Node {
    const start = n.getStart(sf), lc = sf.getLineAndCharacterOfPosition(start);
    return { id: nextId++, span: { file, start, end: n.end, line: lc.line + 1, column: lc.character + 1 } };
  }
  const errors = (sf as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
  if (errors.length) {
    const d = errors[0]!, start = d.start ?? 0, lc = sf.getLineAndCharacterOfPosition(start);
    fail('E_PARSE', ts.flattenDiagnosticMessageText(d.messageText, '\n'),
      { file, start, end: start + (d.length ?? 0), line: lc.line + 1, column: lc.character + 1 });
  }
  function unsupported(n: ts.Node, description = ts.SyntaxKind[n.kind]): never {
    return fail('E_UNSUPPORTED_SYNTAX', `${description} is not supported by the primitive compiler profile.`, meta(n).span);
  }
  function annotation(n: ts.TypeNode | undefined): void {
    if (!n) return;
    if (!file.endsWith('.ts')) unsupported(n, 'Type annotation in JavaScript');
    // Purely erasable scalar annotations only. They do not narrow runtime facts.
    if (![ts.SyntaxKind.NumberKeyword, ts.SyntaxKind.StringKeyword, ts.SyntaxKind.BooleanKeyword,
      ts.SyntaxKind.AnyKeyword, ts.SyntaxKind.UnknownKeyword, ts.SyntaxKind.VoidKeyword,
      ts.SyntaxKind.UndefinedKeyword].includes(n.kind)) unsupported(n, 'This TypeScript annotation');
  }
  function expr(n: ts.Expression): Expr {
    const m = meta(n);
    if (ts.isParenthesizedExpression(n)) return expr(n.expression);
    if (ts.isNumericLiteral(n)) return { ...m, kind: 'literal', value: Number(n.text) };
    if (ts.isStringLiteral(n)) return { ...m, kind: 'literal', value: n.text };
    if (n.kind === ts.SyntaxKind.TrueKeyword || n.kind === ts.SyntaxKind.FalseKeyword)
      return { ...m, kind: 'literal', value: n.kind === ts.SyntaxKind.TrueKeyword };
    if (n.kind === ts.SyntaxKind.NullKeyword) return { ...m, kind: 'literal', value: null };
    if (ts.isIdentifier(n)) return { ...m, kind: 'identifier', name: n.text };
    if (ts.isBinaryExpression(n)) {
      const op = n.operatorToken.getText(sf);
      if (op === '=') {
        const target = expr(n.left);
        if (target.kind !== 'identifier') unsupported(n.left, 'Property/destructuring assignment');
        return { ...m, kind: 'assign', target, value: expr(n.right) };
      }
      if (!['+', '-', '*', '/', '%', '<', '<=', '>', '>=', '===', '!=='].includes(op)) unsupported(n, `Operator ${op}`);
      return { ...m, kind: 'binary', op, left: expr(n.left), right: expr(n.right) };
    }
    if (ts.isPrefixUnaryExpression(n)) {
      const op = ts.tokenToString(n.operator)!;
      if (!['-', '!'].includes(op)) unsupported(n, `Unary operator ${op}`);
      return { ...m, kind: 'unary', op, operand: expr(n.operand) };
    }
    if (ts.isPropertyAccessExpression(n)) {
      if (n.questionDotToken) unsupported(n, 'Optional property access');
      return { ...m, kind: 'member', object: expr(n.expression), property: n.name.text };
    }
    if (ts.isCallExpression(n)) {
      if (n.questionDotToken || n.typeArguments?.length) unsupported(n, 'Optional/generic call');
      return { ...m, kind: 'call', callee: expr(n.expression), args: n.arguments.map(expr) };
    }
    return unsupported(n);
  }
  function statement(n: ts.Statement): Statement[] {
    const m = meta(n);
    if (ts.isVariableStatement(n)) {
      if (n.modifiers?.length) unsupported(n, 'Exported/ambient variable');
      const flags = n.declarationList.flags;
      const mode = flags & ts.NodeFlags.Const ? 'const' : flags & ts.NodeFlags.Let ? 'let' : undefined;
      if (!mode || flags & ts.NodeFlags.Using) unsupported(n, 'var/using declaration');
      return n.declarationList.declarations.map(d => {
        if (!ts.isIdentifier(d.name) || d.exclamationToken) unsupported(d, 'Destructuring/definite assignment declaration');
        annotation(d.type);
        if (mode === 'const' && !d.initializer) fail('E_CONST_INIT', 'const requires an initializer.', meta(d).span);
        return { ...meta(d), kind: 'variable', mode, name: d.name.text, initializer: d.initializer && expr(d.initializer) };
      });
    }
    if (ts.isBlock(n)) return [{ ...m, kind: 'block', body: n.statements.flatMap(statement) }];
    if (ts.isExpressionStatement(n)) return [{ ...m, kind: 'expression', expression: expr(n.expression) }];
    if (ts.isEmptyStatement(n)) return [{ ...m, kind: 'empty' }];
    if (ts.isIfStatement(n)) {
      // Lexical declarations in a single-statement arm are early errors in JavaScript.
      for (const arm of [n.thenStatement, n.elseStatement]) {
        if (arm && (ts.isVariableStatement(arm) || ts.isFunctionDeclaration(arm))) unsupported(arm, 'Unbraced lexical/function declaration');
      }
      return [{ ...m, kind: 'if', condition: expr(n.expression), then: statement(n.thenStatement)[0]!,
        otherwise: n.elseStatement && statement(n.elseStatement)[0]! }];
    }
    if (ts.isReturnStatement(n)) return [{ ...m, kind: 'return', value: n.expression && expr(n.expression) }];
    if (ts.isFunctionDeclaration(n)) {
      if (!n.name || !n.body || n.asteriskToken || n.modifiers?.length || n.typeParameters?.length)
        unsupported(n, 'Async/generator/ambient/exported/generic function');
      annotation(n.type);
      const params = n.parameters.map(p => {
        if (!ts.isIdentifier(p.name) || p.initializer || p.dotDotDotToken || p.questionToken || p.modifiers?.length)
          unsupported(p, 'Default/rest/optional/destructured parameter');
        annotation(p.type);
        return { ...meta(p), name: p.name.text };
      });
      return [{ ...m, kind: 'function', name: n.name.text, params,
        body: statement(n.body)[0] as Statement & { kind: 'block' } }];
    }
    return unsupported(n);
  }
  const body = sf.statements.flatMap(statement);
  // TypeScript's parser accepts some early-error programs. V8 provides a syntax-only
  // grammar check; Script construction NEVER evaluates the input. Only the admitted,
  // erasable TS subset is transpiled here, solely for this grammar check.
  const javascript = file.endsWith('.ts') ? ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText : source;
  try { new Script(javascript, { filename: file }); }
  catch (e) { fail('E_PARSE', `Invalid JavaScript runtime grammar: ${(e as Error).message}`, {
    file, start: 0, end: source.length, line: 1, column: 1,
  }); }
  return { file, body };
}
