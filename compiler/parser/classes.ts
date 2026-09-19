import ts from 'typescript';
import { Script } from 'node:vm';
import { fail, type Span } from '../diagnostics/index.js';

export type ClassLiteral = number | string | boolean | null | undefined;
export type ClassExpr =
  | { kind: 'literal'; value: ClassLiteral; span: Span }
  | { kind: 'staticRead'; className: string; property: string; span: Span }
  | { kind: 'staticCall'; className: string; method: string; args: ClassExpr[]; span: Span }
  | { kind: 'consoleLog'; args: ClassExpr[]; span: Span };

export interface ParsedStaticField {
  kind: 'staticField'; name: string; initializer: ClassExpr; span: Span;
}
export interface ParsedStaticMethod {
  kind: 'staticMethod'; name: string; params: string[]; result: ClassExpr;
  usesThis: boolean; usesSuper: boolean; span: Span;
}
export interface ParsedInstanceField {
  kind: 'instanceField'; name: string; hasInitializer: boolean; span: Span;
}
export interface ParsedInstanceMethod {
  kind: 'instanceMethod'; name: string; usesThis: boolean; usesSuper: boolean; span: Span;
}
export interface ParsedConstructor {
  kind: 'constructor'; derived: boolean; hasSuperCall: boolean; superCallCount: number;
  superFirstObservable: boolean; thisBeforeSuper: boolean; hasReturnValue: boolean; span: Span;
}
export type ParsedClassElement =
  | ParsedStaticField | ParsedStaticMethod | ParsedInstanceField | ParsedInstanceMethod | ParsedConstructor;

export interface ParsedClass {
  kind: 'class'; bindingName: string; displayName: string; expression: boolean;
  baseName?: string; dynamicBase: boolean; elements: ParsedClassElement[]; span: Span;
}
export type ClassAction =
  | { kind: 'console'; args: ClassExpr[]; span: Span }
  | { kind: 'staticAssign'; className: string; property: string; value: ClassExpr; span: Span }
  | { kind: 'staticCall'; call: Extract<ClassExpr, { kind: 'staticCall' }>; span: Span };
export type ClassProgramItem = ParsedClass | ClassAction;
export interface ParsedClassProgram { items: ClassProgramItem[]; classes: ParsedClass[]; file: string }

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  const modifiers = (node as ts.Node & { modifiers?: ts.NodeArray<ts.ModifierLike> }).modifiers;
  return !!modifiers?.some(m => m.kind === kind);
}

export function parseClassProgram(source: string, file = 'input.js'): ParsedClassProgram | undefined {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  const parseDiagnostics = (sf as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
  if (parseDiagnostics.length) {
    const d = parseDiagnostics[0]!, start = d.start ?? 0, lc = sf.getLineAndCharacterOfPosition(start);
    fail('E_PARSE', ts.flattenDiagnosticMessageText(d.messageText, '\n'),
      { file, start, end: start + (d.length ?? 0), line: lc.line + 1, column: lc.character + 1 });
  }
  const hasClass = sf.statements.some(s => ts.isClassDeclaration(s)
    || (ts.isVariableStatement(s) && s.declarationList.declarations.some(d => !!d.initializer && ts.isClassExpression(d.initializer))));
  if (!hasClass) return undefined;

  function span(n: ts.Node): Span {
    const start = n.getStart(sf), lc = sf.getLineAndCharacterOfPosition(start);
    return { file, start, end: n.end, line: lc.line + 1, column: lc.character + 1 };
  }
  function unsupported(n: ts.Node, description: string): never {
    return fail('E_CLASS_UNSUPPORTED', `${description} is not supported by the independent class lane.`, span(n));
  }
  function staticName(n: ts.PropertyName): string {
    if (ts.isPrivateIdentifier(n)) unsupported(n, 'Private class elements');
    if (ts.isComputedPropertyName(n)) unsupported(n, 'Computed class element names');
    if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n)) return n.text;
    return unsupported(n, 'Class element name');
  }
  function valueExpr(n: ts.Expression): ClassExpr {
    const s = span(n);
    if (ts.isParenthesizedExpression(n)) return valueExpr(n.expression);
    if (ts.isNumericLiteral(n)) return { kind: 'literal', value: Number(n.text), span: s };
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return { kind: 'literal', value: n.text, span: s };
    if (n.kind === ts.SyntaxKind.TrueKeyword || n.kind === ts.SyntaxKind.FalseKeyword)
      return { kind: 'literal', value: n.kind === ts.SyntaxKind.TrueKeyword, span: s };
    if (n.kind === ts.SyntaxKind.NullKeyword) return { kind: 'literal', value: null, span: s };
    if (ts.isIdentifier(n) && n.text === 'undefined') return { kind: 'literal', value: undefined, span: s };
    if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(n.operand))
      return { kind: 'literal', value: -Number(n.operand.text), span: s };
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression))
      return { kind: 'staticRead', className: n.expression.text, property: n.name.text, span: s };
    if (ts.isCallExpression(n) && !n.questionDotToken && !n.typeArguments?.length && ts.isPropertyAccessExpression(n.expression)) {
      const receiver = n.expression.expression;
      if (ts.isIdentifier(receiver) && receiver.text === 'console' && n.expression.name.text === 'log')
        return { kind: 'consoleLog', args: n.arguments.map(valueExpr), span: s };
      if (ts.isIdentifier(receiver))
        return { kind: 'staticCall', className: receiver.text, method: n.expression.name.text,
          args: n.arguments.map(valueExpr), span: s };
    }
    return unsupported(n, 'This class expression');
  }
  function scans(node: ts.Node): { usesThis: boolean; usesSuper: boolean } {
    let usesThis = false, usesSuper = false;
    const visit = (n: ts.Node): void => {
      if (n.kind === ts.SyntaxKind.ThisKeyword) usesThis = true;
      if (n.kind === ts.SyntaxKind.SuperKeyword) usesSuper = true;
      ts.forEachChild(n, visit);
    };
    visit(node); return { usesThis, usesSuper };
  }
  function constructorInfo(n: ts.ConstructorDeclaration, derived: boolean): ParsedConstructor {
    let superCallCount = 0, firstSuperIndex = -1, thisBeforeSuper = false, hasReturnValue = false;
    const statements = n.body?.statements ?? [];
    statements.forEach((statement, i) => {
      let containsSuper = false, containsThis = false;
      const visit = (x: ts.Node): void => {
        if (x.kind === ts.SyntaxKind.ThisKeyword) containsThis = true;
        if (ts.isCallExpression(x) && x.expression.kind === ts.SyntaxKind.SuperKeyword) {
          containsSuper = true; superCallCount++;
          if (firstSuperIndex < 0) firstSuperIndex = i;
        }
        if (ts.isReturnStatement(x) && !!x.expression) hasReturnValue = true;
        ts.forEachChild(x, visit);
      };
      visit(statement);
      if (containsThis && firstSuperIndex < 0) thisBeforeSuper = true;
    });
    return { kind: 'constructor', derived, hasSuperCall: superCallCount > 0, superCallCount,
      superFirstObservable: firstSuperIndex === 0, thisBeforeSuper, hasReturnValue, span: span(n) };
  }
  function parsedClass(n: ts.ClassLikeDeclaration, bindingName: string, expression: boolean): ParsedClass {
    if (n.typeParameters?.length || hasModifier(n, ts.SyntaxKind.DeclareKeyword) || hasModifier(n, ts.SyntaxKind.ExportKeyword))
      unsupported(n, 'Generic/ambient/exported class');
    const heritage = n.heritageClauses?.find(h => h.token === ts.SyntaxKind.ExtendsKeyword);
    let baseName: string | undefined, dynamicBase = false;
    if (heritage) {
      if (heritage.types.length !== 1) unsupported(heritage, 'Multiple class bases');
      const base = heritage.types[0]!.expression;
      if (ts.isIdentifier(base)) baseName = base.text; else dynamicBase = true;
    }
    const derived = !!heritage;
    const elements: ParsedClassElement[] = [];
    for (const member of n.members) {
      if (ts.isPropertyDeclaration(member)) {
        if (member.questionToken || member.exclamationToken || member.type) {
          if (!file.endsWith('.ts')) unsupported(member, 'Typed/optional class field in JavaScript');
        }
        const name = staticName(member.name);
        if (hasModifier(member, ts.SyntaxKind.StaticKeyword)) {
          if (!member.initializer) unsupported(member, 'Uninitialized static field');
          elements.push({ kind: 'staticField', name, initializer: valueExpr(member.initializer), span: span(member) });
        } else {
          elements.push({ kind: 'instanceField', name, hasInitializer: !!member.initializer, span: span(member) });
        }
        continue;
      }
      if (ts.isMethodDeclaration(member)) {
        if (!member.body || member.asteriskToken || member.questionToken || member.typeParameters?.length
          || hasModifier(member, ts.SyntaxKind.AsyncKeyword)) unsupported(member, 'Async/generator/abstract/generic class method');
        const name = staticName(member.name), flags = scans(member.body);
        if (hasModifier(member, ts.SyntaxKind.StaticKeyword)) {
          if (member.parameters.length) unsupported(member, 'Static method parameters (argument semantics are owned by a sibling lane)');
          if (member.body.statements.length !== 1 || !ts.isReturnStatement(member.body.statements[0])
            || !member.body.statements[0].expression) unsupported(member, 'Static method body outside a single return expression');
          elements.push({ kind: 'staticMethod', name, params: [], result: valueExpr(member.body.statements[0].expression),
            ...flags, span: span(member) });
        } else {
          elements.push({ kind: 'instanceMethod', name, ...flags, span: span(member) });
        }
        continue;
      }
      if (ts.isConstructorDeclaration(member)) {
        elements.push(constructorInfo(member, derived)); continue;
      }
      if (ts.isClassStaticBlockDeclaration(member)) unsupported(member, 'Static initialization block');
      if (ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member))
        unsupported(member, 'Class accessor');
      unsupported(member, 'Class element');
    }
    return { kind: 'class', bindingName, displayName: n.name?.text ?? bindingName, expression,
      baseName, dynamicBase, elements, span: span(n) };
  }

  const items: ClassProgramItem[] = [], classes: ParsedClass[] = [];
  for (const statement of sf.statements) {
    if (ts.isClassDeclaration(statement)) {
      if (!statement.name) unsupported(statement, 'Anonymous class declaration');
      const c = parsedClass(statement, statement.name.text, false); items.push(c); classes.push(c); continue;
    }
    if (ts.isVariableStatement(statement)) {
      const decls = statement.declarationList.declarations;
      if (decls.length === 1 && ts.isIdentifier(decls[0]!.name) && decls[0]!.initializer
        && ts.isClassExpression(decls[0]!.initializer)) {
        if (!(statement.declarationList.flags & ts.NodeFlags.Const)) unsupported(statement, 'Class expression binding must be const');
        const c = parsedClass(decls[0]!.initializer, decls[0]!.name.text, true); items.push(c); classes.push(c); continue;
      }
      unsupported(statement, 'Non-class variable declaration mixed with class lane');
    }
    if (ts.isExpressionStatement(statement)) {
      const e = statement.expression;
      if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && ts.isPropertyAccessExpression(e.left) && ts.isIdentifier(e.left.expression)) {
        items.push({ kind: 'staticAssign', className: e.left.expression.text, property: e.left.name.text,
          value: valueExpr(e.right), span: span(statement) }); continue;
      }
      const parsed = valueExpr(e);
      if (parsed.kind === 'consoleLog') { items.push({ kind: 'console', args: parsed.args, span: span(statement) }); continue; }
      if (parsed.kind === 'staticCall') { items.push({ kind: 'staticCall', call: parsed, span: span(statement) }); continue; }
      unsupported(statement, 'Top-level class-lane expression');
    }
    if (ts.isEmptyStatement(statement)) continue;
    unsupported(statement, 'Top-level statement mixed with class lane');
  }

  const javascript = file.endsWith('.ts') ? ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText : source;
  try { new Script(javascript, { filename: file }); }
  catch (e) { fail('E_PARSE', `Invalid JavaScript runtime grammar: ${(e as Error).message}`,
    { file, start: 0, end: source.length, line: 1, column: 1 }); }
  return { items, classes, file };
}
