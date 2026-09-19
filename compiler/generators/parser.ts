import ts from 'typescript';
import { Script } from 'node:vm';
import { fail, type Span } from '../diagnostics/index.js';

export interface GNode { span: Span }
export type GLiteral = number | string | boolean | null | undefined;
export type GExpr = GNode & (
  | { kind: 'literal'; value: GLiteral }
  | { kind: 'identifier'; name: string }
  | { kind: 'object'; properties: Array<{ key: string; value: GExpr }> }
  | { kind: 'array'; elements: Array<GExpr | null> }
  | { kind: 'binary'; op: '+' | '===' | '!=='; left: GExpr; right: GExpr }
  | { kind: 'assign'; name: string; value: GExpr }
  | { kind: 'member'; object: GExpr; property: string }
  | { kind: 'call'; callee: GExpr; args: GExpr[] }
  | { kind: 'yield'; delegate: boolean; value: GExpr }
);
export type GStmt = GNode & (
  | { kind: 'variable'; mode: 'const' | 'let'; name: string; initializer?: GExpr }
  | { kind: 'expression'; expression: GExpr }
  | { kind: 'return'; value: GExpr }
  | { kind: 'empty' }
);
export interface GFunction extends GNode {
  kind: 'generator';
  name: string;
  params: string[];
  body: GStmt[];
}
export interface GProgram {
  file: string;
  functions: GFunction[];
  body: GStmt[];
}

export function parseGeneratorProgram(source: string, file = 'input.js'): GProgram | undefined {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  const hasGenerator = sf.statements.some(s => ts.isFunctionDeclaration(s) && !!s.asteriskToken);
  if (!hasGenerator) return undefined;

  const errors = (sf as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
  if (errors.length) {
    const d = errors[0]!;
    const start = d.start ?? 0;
    const lc = sf.getLineAndCharacterOfPosition(start);
    fail('E_PARSE', ts.flattenDiagnosticMessageText(d.messageText, '\n'), {
      file, start, end: start + (d.length ?? 0), line: lc.line + 1, column: lc.character + 1,
    });
  }

  function span(n: ts.Node): Span {
    const start = n.getStart(sf);
    const lc = sf.getLineAndCharacterOfPosition(start);
    return { file, start, end: n.end, line: lc.line + 1, column: lc.character + 1 };
  }
  function unsupported(n: ts.Node, message: string, code = 'E_GENERATOR_PROFILE_SYNTAX'): never {
    return fail(code, message, span(n));
  }
  function propertyName(n: ts.PropertyName): string {
    if (ts.isIdentifier(n) || ts.isStringLiteral(n)) return n.text;
    if (ts.isNumericLiteral(n)) return String(Number(n.text));
    return unsupported(n, 'Generator profile requires a static property name.');
  }
  function expr(n: ts.Expression): GExpr {
    const s = span(n);
    if (ts.isParenthesizedExpression(n)) return expr(n.expression);
    if (ts.isNumericLiteral(n)) return { span: s, kind: 'literal', value: Number(n.text) };
    if (ts.isStringLiteral(n)) return { span: s, kind: 'literal', value: n.text };
    if (n.kind === ts.SyntaxKind.TrueKeyword || n.kind === ts.SyntaxKind.FalseKeyword)
      return { span: s, kind: 'literal', value: n.kind === ts.SyntaxKind.TrueKeyword };
    if (n.kind === ts.SyntaxKind.NullKeyword) return { span: s, kind: 'literal', value: null };
    if (ts.isIdentifier(n)) return { span: s, kind: 'identifier', name: n.text };
    if (ts.isObjectLiteralExpression(n)) {
      const properties = n.properties.map(p => {
        if (!ts.isPropertyAssignment(p))
          return unsupported(p, 'Generator profile does not admit object spread, shorthand, methods, or accessors.');
        const key = propertyName(p.name);
        if (key === '__proto__') unsupported(p.name, 'Object-literal __proto__ mutation is not admitted.');
        return { key, value: expr(p.initializer) };
      });
      return { span: s, kind: 'object', properties };
    }
    if (ts.isArrayLiteralExpression(n)) {
      const elements = n.elements.map(e => {
        if (ts.isOmittedExpression(e)) return null;
        if (ts.isSpreadElement(e)) return unsupported(e, 'Array spread is not admitted by the generator lane.');
        return expr(e);
      });
      return { span: s, kind: 'array', elements };
    }
    if (ts.isBinaryExpression(n)) {
      const op = n.operatorToken.getText(sf);
      if (op === '=') {
        if (!ts.isIdentifier(n.left))
          return unsupported(n.left, 'Generator profile assignment target must be a lexical identifier.');
        return { span: s, kind: 'assign', name: n.left.text, value: expr(n.right) };
      }
      if (op !== '+' && op !== '===' && op !== '!==')
        return unsupported(n, 'Operator ' + op + ' is not admitted by the bounded generator lane.');
      return { span: s, kind: 'binary', op, left: expr(n.left), right: expr(n.right) };
    }
    if (ts.isPropertyAccessExpression(n)) {
      if (n.questionDotToken) return unsupported(n, 'Optional chaining is not admitted by the generator lane.');
      return { span: s, kind: 'member', object: expr(n.expression), property: n.name.text };
    }
    if (ts.isElementAccessExpression(n))
      return unsupported(n, 'Computed property access is not admitted by the generator lane.');
    if (ts.isCallExpression(n)) {
      if (n.questionDotToken || n.typeArguments?.length)
        return unsupported(n, 'Optional/generic calls are not admitted by the generator lane.');
      return { span: s, kind: 'call', callee: expr(n.expression), args: n.arguments.map(expr) };
    }
    if (ts.isYieldExpression(n)) {
      return {
        span: s,
        kind: 'yield',
        delegate: !!n.asteriskToken,
        value: n.expression ? expr(n.expression) : { span: s, kind: 'literal', value: undefined },
      };
    }
    if (ts.isNewExpression(n))
      return unsupported(n, 'Generator construction with new is a separate constructor-semantics lane.', 'E_GENERATOR_CONSTRUCTOR_DEPENDENCY');
    return unsupported(n, 'Expression ' + ts.SyntaxKind[n.kind] + ' is not admitted by the bounded generator lane.');
  }

  function declarationList(list: ts.VariableDeclarationList): GStmt[] {
    const mode = list.flags & ts.NodeFlags.Const ? 'const' : list.flags & ts.NodeFlags.Let ? 'let' : undefined;
    if (!mode) return unsupported(list, 'var/using declarations are not admitted by the generator lane.');
    return list.declarations.map(d => {
      if (!ts.isIdentifier(d.name) || d.exclamationToken)
        return unsupported(d, 'Destructuring/definite-assignment declarations are not admitted.');
      if (mode === 'const' && !d.initializer)
        fail('E_CONST_INIT', 'const requires an initializer.', span(d));
      return {
        span: span(d), kind: 'variable' as const, mode, name: d.name.text,
        initializer: d.initializer ? expr(d.initializer) : undefined,
      };
    });
  }

  function statements(nodes: readonly ts.Statement[], inGenerator: boolean): GStmt[] {
    const result: GStmt[] = [];
    for (const n of nodes) {
      if (ts.isVariableStatement(n)) {
        if (n.modifiers?.length) unsupported(n, 'Exported/ambient variables are not admitted.');
        result.push(...declarationList(n.declarationList));
        continue;
      }
      if (ts.isExpressionStatement(n)) {
        result.push({ span: span(n), kind: 'expression', expression: expr(n.expression) });
        continue;
      }
      if (ts.isReturnStatement(n)) {
        if (!inGenerator) unsupported(n, 'return outside a generator is invalid.', 'E_RETURN_CONTEXT');
        result.push({
          span: span(n), kind: 'return',
          value: n.expression ? expr(n.expression) : { span: span(n), kind: 'literal', value: undefined },
        });
        continue;
      }
      if (ts.isEmptyStatement(n)) {
        result.push({ span: span(n), kind: 'empty' });
        continue;
      }
      if (ts.isTryStatement(n))
        unsupported(n, 'try/catch/finally inside generators waits for the exception/completion lane.', 'E_GENERATOR_EXCEPTIONS_DEPENDENCY');
      if (ts.isForOfStatement(n))
        unsupported(n, 'for...of/IteratorClose syntax is deferred; yield* and return() use the generator iterator contract.', 'E_GENERATOR_FOR_OF_DEFERRED');
      if (ts.isFunctionDeclaration(n))
        unsupported(n, 'Nested or ordinary functions are not admitted in the isolated generator lane.', 'E_GENERATOR_MIXED_FUNCTIONS');
      unsupported(n, 'Control-flow statement ' + ts.SyntaxKind[n.kind] + ' is not admitted by the bounded generator lane.');
    }
    return result;
  }

  const functions: GFunction[] = [];
  const bodyNodes: ts.Statement[] = [];
  for (const n of sf.statements) {
    if (!ts.isFunctionDeclaration(n)) {
      bodyNodes.push(n);
      continue;
    }
    if (!n.asteriskToken)
      unsupported(n, 'Ordinary functions in a generator-bearing file are owned by the functions/closures lane.', 'E_GENERATOR_MIXED_FUNCTIONS');
    if (!n.name || !n.body)
      unsupported(n, 'Generator declaration requires a name and body.');
    if (n.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword))
      unsupported(n, 'Async generators are owned by the async-generator lane.', 'E_GENERATOR_ASYNC_DEFERRED');
    if (n.modifiers?.length || n.typeParameters?.length)
      unsupported(n, 'Exported/ambient/generic generator declarations are not admitted.');
    const params = n.parameters.map(p => {
      if (!ts.isIdentifier(p.name) || p.initializer || p.dotDotDotToken || p.questionToken || p.modifiers?.length)
        return unsupported(p, 'Generator parameters must be simple identifiers in this lane.');
      return p.name.text;
    });
    functions.push({ span: span(n), kind: 'generator', name: n.name.text, params, body: statements(n.body.statements, true) });
  }

  const javascript = file.endsWith('.ts') ? ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText : source;
  try {
    new Script(javascript, { filename: file });
  } catch (error) {
    fail('E_PARSE', 'Invalid JavaScript runtime grammar: ' + (error as Error).message, {
      file, start: 0, end: source.length, line: 1, column: 1,
    });
  }

  return { file, functions, body: statements(bodyNodes, false) };
}
