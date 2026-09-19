import ts from 'typescript';
import { fail } from '../diagnostics/index.js';
import type { Span } from '../diagnostics/index.js';

export interface ArrowSyntax {
  id: number;
  span: Span;
  parameters: readonly string[];
  bodyKind: 'expression' | 'block';
  usesLexicalThis: boolean;
  usesLexicalArguments: boolean;
  usesLexicalNewTarget: boolean;
}

/**
 * Isolated ArrowFunction syntax contract used while the shared parser/function-value
 * integration is owned by another open lane. It is AST based and intentionally does
 * not rewrite source text.
 */
export function inspectArrowFunctions(source: string, file = 'input.js'): ArrowSyntax[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  const diagnostics = (sf as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
  if (diagnostics.length) {
    const d = diagnostics[0]!, start = d.start ?? 0, lc = sf.getLineAndCharacterOfPosition(start);
    return fail('E_PARSE', ts.flattenDiagnosticMessageText(d.messageText, '\n'),
      { file, start, end: start + (d.length ?? 0), line: lc.line + 1, column: lc.character + 1 });
  }

  let nextId = 0;
  const result: ArrowSyntax[] = [];
  const span = (n: ts.Node): Span => {
    const start = n.getStart(sf), lc = sf.getLineAndCharacterOfPosition(start);
    return { file, start, end: n.end, line: lc.line + 1, column: lc.character + 1 };
  };

  function inspect(n: ts.ArrowFunction): ArrowSyntax {
    if (n.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword))
      return fail('E_ARROW_ASYNC_DEPENDENCY', 'Async arrow functions are owned by the async workstream.', span(n));
    if (n.typeParameters?.length)
      return fail('E_ARROW_GENERIC', 'Generic arrow functions require TypeScript generic lowering before runtime semantics can be proven.', span(n));
    if (n.parameters.some(p => !ts.isIdentifier(p.name) || p.initializer || p.dotDotDotToken || p.questionToken || p.modifiers?.length))
      return fail('E_ARROW_PARAMETER_SHAPE', 'Default/rest/optional/destructured arrow parameters are not admitted by this lane.', span(n));
    if (n.parameters.some(p => ts.isIdentifier(p.name) && p.name.text === 'arguments'))
      return fail('E_ARROW_ARGUMENTS_SHADOW', "An arrow parameter named 'arguments' is deferred until lexical arguments scope proof is integrated.", span(n));

    let usesLexicalThis = false, usesLexicalArguments = false, usesLexicalNewTarget = false;
    function lexicalWalk(node: ts.Node): void {
      if (node !== n && ts.isFunctionLike(node) && !ts.isArrowFunction(node)) return;
      if (node !== n && ts.isClassLike(node)) return;
      if (node.kind === ts.SyntaxKind.ThisKeyword) usesLexicalThis = true;
      if (ts.isIdentifier(node) && node.text === 'arguments') usesLexicalArguments = true;
      if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.NewKeyword && node.name.text === 'target')
        usesLexicalNewTarget = true;
      ts.forEachChild(node, lexicalWalk);
    }
    lexicalWalk(n.body);
    return {
      id: nextId++,
      span: span(n),
      parameters: n.parameters.map(p => (p.name as ts.Identifier).text),
      bodyKind: ts.isBlock(n.body) ? 'block' : 'expression',
      usesLexicalThis,
      usesLexicalArguments,
      usesLexicalNewTarget,
    };
  }

  function visit(n: ts.Node): void {
    if (ts.isArrowFunction(n)) result.push(inspect(n));
    ts.forEachChild(n, visit);
  }
  visit(sf);
  return result;
}
