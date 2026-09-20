import ts from 'typescript';
import { Script } from 'node:vm';
import { fail } from '../diagnostics/index.js';
import type { Expr, ForInitializer, Node, Program, Statement, VariableStatement } from './ast.js';

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
    return fail('E_UNSUPPORTED_SYNTAX', `${description} is not supported by the current compiler profile.`, meta(n).span);
  }
  function annotation(n: ts.TypeNode | undefined): void {
    if (!n) return;
    if (!file.endsWith('.ts')) unsupported(n, 'Type annotation in JavaScript');
    if (![ts.SyntaxKind.NumberKeyword, ts.SyntaxKind.StringKeyword, ts.SyntaxKind.BooleanKeyword,
      ts.SyntaxKind.AnyKeyword, ts.SyntaxKind.UnknownKeyword, ts.SyntaxKind.VoidKeyword,
      ts.SyntaxKind.UndefinedKeyword].includes(n.kind)) unsupported(n, 'This TypeScript annotation');
  }
  function propertyName(n: ts.PropertyName): string {
    if (ts.isComputedPropertyName(n)) unsupported(n, 'Computed property name');
    if (ts.isIdentifier(n) || ts.isStringLiteral(n)) return n.text;
    if (ts.isNumericLiteral(n)) return String(Number(n.text));
    return unsupported(n, 'Property name');
  }
  function elementProperty(n: ts.Expression): string {
    if (ts.isStringLiteral(n)) return n.text;
    if (ts.isNumericLiteral(n)) return String(Number(n.text));
    return unsupported(n, 'Dynamic computed property key');
  }
  function expr(n: ts.Expression): Expr {
    const m = meta(n);
    if (ts.isParenthesizedExpression(n)) return expr(n.expression);
    if (ts.isNumericLiteral(n)) return { ...m, kind: 'literal', value: Number(n.text) };
    if (ts.isStringLiteral(n)) return { ...m, kind: 'literal', value: n.text };
    if (n.kind === ts.SyntaxKind.TrueKeyword || n.kind === ts.SyntaxKind.FalseKeyword)
      return { ...m, kind: 'literal', value: n.kind === ts.SyntaxKind.TrueKeyword };
    if (n.kind === ts.SyntaxKind.NullKeyword) return { ...m, kind: 'literal', value: null };
    if (n.kind === ts.SyntaxKind.ThisKeyword) return { ...m, kind: 'thisValue' };
    if (ts.isMetaProperty(n)) {
      if (n.keywordToken === ts.SyntaxKind.NewKeyword && n.name.text === 'target')
        return { ...m, kind: 'newTarget' };
      return unsupported(n, 'Meta property');
    }
    if (ts.isIdentifier(n)) return { ...m, kind: 'identifier', name: n.text };
    if (ts.isObjectLiteralExpression(n)) {
      const properties = n.properties.map(p => {
        if (!ts.isPropertyAssignment(p)) unsupported(p, 'Object spread/shorthand/method/accessor');
        const key = propertyName(p.name);
        if (key === '__proto__') unsupported(p.name, 'Object-literal __proto__ prototype mutation');
        return { key, value: expr(p.initializer) };
      });
      return { ...m, kind: 'object', properties };
    }
    if (ts.isArrayLiteralExpression(n)) {
      const elements = n.elements.map(e => {
        if (ts.isOmittedExpression(e)) return null;
        if (ts.isSpreadElement(e)) unsupported(e, 'Array spread');
        return expr(e);
      });
      return { ...m, kind: 'array', elements };
    }
    if (ts.isBinaryExpression(n)) {
      const op = n.operatorToken.getText(sf);
      if (op === '=') {
        const target = expr(n.left);
        if (target.kind !== 'identifier' && target.kind !== 'member') unsupported(n.left, 'Destructuring/unsupported assignment target');
        return { ...m, kind: 'assign', target, value: expr(n.right) };
      }
      if (['+=', '-=', '*=', '/=', '%='].includes(op)) {
        const target = expr(n.left);
        if (target.kind !== 'identifier') unsupported(n.left, 'Property/destructuring compound assignment');
        return { ...m, kind: 'compound', op: op as '+=' | '-=' | '*=' | '/=' | '%=', target, value: expr(n.right) };
      }
      if (!['+', '-', '*', '/', '%', '<', '<=', '>', '>=', '==', '!=', '===', '!=='].includes(op)) unsupported(n, `Operator ${op}`);
      return { ...m, kind: 'binary', op, left: expr(n.left), right: expr(n.right) };
    }
    if (ts.isPrefixUnaryExpression(n)) {
      const op = ts.tokenToString(n.operator)!;
      if (op === '++' || op === '--') {
        const target = expr(n.operand);
        if (target.kind !== 'identifier') unsupported(n.operand, 'Property update');
        return { ...m, kind: 'update', op, prefix: true, target };
      }
      if (!['-', '+', '!'].includes(op)) unsupported(n, `Unary operator ${op}`);
      return { ...m, kind: 'unary', op, operand: expr(n.operand) };
    }
    if (ts.isPostfixUnaryExpression(n)) {
      const op = ts.tokenToString(n.operator)!;
      if (op !== '++' && op !== '--') unsupported(n, `Postfix operator ${op}`);
      const target = expr(n.operand);
      if (target.kind !== 'identifier') unsupported(n.operand, 'Property update');
      return { ...m, kind: 'update', op, prefix: false, target };
    }
    if (ts.isPropertyAccessExpression(n)) {
      if (n.questionDotToken) unsupported(n, 'Optional property access');
      return { ...m, kind: 'member', object: expr(n.expression), property: n.name.text };
    }
    if (ts.isElementAccessExpression(n)) {
      if (n.questionDotToken || !n.argumentExpression) unsupported(n, 'Optional/empty element access');
      return { ...m, kind: 'member', object: expr(n.expression), property: elementProperty(n.argumentExpression) };
    }
    if (ts.isCallExpression(n)) {
      if (n.questionDotToken || n.typeArguments?.length) unsupported(n, 'Optional/generic call');
      return { ...m, kind: 'call', callee: expr(n.expression), args: n.arguments.map(expr) };
    }
    if (ts.isNewExpression(n)) {
      if (n.typeArguments?.length) unsupported(n, 'Generic construction');
      return { ...m, kind: 'construct', callee: expr(n.expression), args: (n.arguments ?? []).map(expr) };
    }
    return unsupported(n);
  }
  function variables(list: ts.VariableDeclarationList): VariableStatement[] {
    const flags = list.flags;
    const mode = flags & ts.NodeFlags.Const ? 'const' : flags & ts.NodeFlags.Let ? 'let' : undefined;
    if (!mode || flags & ts.NodeFlags.Using) unsupported(list, 'var/using declaration');
    return list.declarations.map(d => {
      if (!ts.isIdentifier(d.name) || d.exclamationToken) unsupported(d, 'Destructuring/definite assignment declaration');
      annotation(d.type);
      if (mode === 'const' && !d.initializer) fail('E_CONST_INIT', 'const requires an initializer.', meta(d).span);
      return { ...meta(d), kind: 'variable', mode, name: d.name.text, initializer: d.initializer && expr(d.initializer) };
    });
  }
  function controlledBody(n: ts.Statement): Statement {
    if (ts.isVariableStatement(n) || ts.isFunctionDeclaration(n)) unsupported(n, 'Unbraced lexical/function declaration');
    return statement(n)[0]!;
  }
  function statement(n: ts.Statement): Statement[] {
    const m = meta(n);
    if (ts.isVariableStatement(n)) {
      if (n.modifiers?.length) unsupported(n, 'Exported/ambient variable');
      return variables(n.declarationList);
    }
    if (ts.isBlock(n)) return [{ ...m, kind: 'block', body: n.statements.flatMap(statement) }];
    if (ts.isExpressionStatement(n)) return [{ ...m, kind: 'expression', expression: expr(n.expression) }];
    if (ts.isEmptyStatement(n)) return [{ ...m, kind: 'empty' }];
    if (ts.isIfStatement(n)) {
      return [{ ...m, kind: 'if', condition: expr(n.expression), then: controlledBody(n.thenStatement),
        otherwise: n.elseStatement && controlledBody(n.elseStatement) }];
    }
    if (ts.isWhileStatement(n)) return [{ ...m, kind: 'while', condition: expr(n.expression), body: controlledBody(n.statement) }];
    if (ts.isDoStatement(n)) return [{ ...m, kind: 'doWhile', body: controlledBody(n.statement), condition: expr(n.expression) }];
    if (ts.isForInStatement(n) || ts.isForOfStatement(n)) return unsupported(n, 'for-in/for-of');
    if (ts.isForStatement(n)) {
      let initializer: ForInitializer | undefined;
      if (n.initializer) {
        initializer = ts.isVariableDeclarationList(n.initializer)
          ? { ...meta(n.initializer), kind: 'variables', declarations: variables(n.initializer) }
          : { ...meta(n.initializer), kind: 'expression', expression: expr(n.initializer) };
      }
      return [{ ...m, kind: 'for', initializer, condition: n.condition && expr(n.condition),
        update: n.incrementor && expr(n.incrementor), body: controlledBody(n.statement) }];
    }
    if (ts.isBreakStatement(n)) {
      if (n.label) unsupported(n, 'Labeled break');
      return [{ ...m, kind: 'break' }];
    }
    if (ts.isContinueStatement(n)) {
      if (n.label) unsupported(n, 'Labeled continue');
      return [{ ...m, kind: 'continue' }];
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
  const javascript = file.endsWith('.ts') ? ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText : source;
  try { new Script(javascript, { filename: file }); }
  catch (e) { fail('E_PARSE', `Invalid JavaScript runtime grammar: ${(e as Error).message}`, {
    file, start: 0, end: source.length, line: 1, column: 1,
  }); }
  return { file, body };
}
