import ts from 'typescript';
import { fail } from '../diagnostics/index.js';
import type { Span } from '../diagnostics/index.js';
import type {
  DefaultExport, IndirectExport, LocalExport, ModuleImport, ModuleIr, ModuleRequest, SideEffectImport, StarExport,
} from './ir.js';

function span(sf: ts.SourceFile, n: ts.Node): Span {
  const start = n.getStart(sf), lc = sf.getLineAndCharacterOfPosition(start);
  return { file: sf.fileName, start, end: n.end, line: lc.line + 1, column: lc.character + 1 };
}

function modifiers(n: ts.Node): readonly ts.ModifierLike[] {
  return (n as ts.Node & { modifiers?: ts.NodeArray<ts.ModifierLike> }).modifiers ?? [];
}

function hasModifier(n: ts.Node, kind: ts.SyntaxKind): boolean {
  return modifiers(n).some(m => m.kind === kind);
}

function failModule(sf: ts.SourceFile, n: ts.Node, message: string): never {
  return fail('E_MODULE_UNSUPPORTED', message, span(sf, n));
}

function moduleSpecifier(sf: ts.SourceFile, n: ts.Expression | undefined, owner: ts.Node): string {
  if (!n || !ts.isStringLiteral(n)) return failModule(sf, owner, 'ESM module specifiers must be static string literals.');
  return n.text;
}

function exportedName(n: ts.ModuleExportName): string {
  return n.text;
}

function declarationNames(sf: ts.SourceFile, statement: ts.VariableStatement): string[] {
  return statement.declarationList.declarations.map(d => {
    if (!ts.isIdentifier(d.name)) return failModule(sf, d, 'Destructured module declarations are not yet normalized by the ESM linker lane.');
    return d.name.text;
  });
}

function hasTopLevelThis(sf: ts.SourceFile): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (n.kind === ts.SyntaxKind.ThisKeyword) { found = true; return; }
    if (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isMethodDeclaration(n)
      || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n) || ts.isConstructorDeclaration(n)
      || ts.isClassDeclaration(n) || ts.isClassExpression(n)) return;
    ts.forEachChild(n, visit);
  };
  for (const statement of sf.statements) visit(statement);
  return found;
}

function rejectDeferredModuleSyntax(sf: ts.SourceFile): void {
  const visit = (n: ts.Node, nestedFunction = false): void => {
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword)
      failModule(sf, n, 'dynamic import() belongs to MODULES_DYNAMIC_IMPORT_TLA and remains fail-closed here.');
    if (ts.isMetaProperty(n) && n.keywordToken === ts.SyntaxKind.ImportKeyword)
      failModule(sf, n, 'import.meta host resolution is not part of the ESM linker contract.');
    if (!nestedFunction && ts.isAwaitExpression(n))
      failModule(sf, n, 'top-level await belongs to MODULES_DYNAMIC_IMPORT_TLA and remains fail-closed here.');
    const childNested = nestedFunction || ts.isFunctionLike(n);
    ts.forEachChild(n, child => visit(child, childNested));
  };
  for (const statement of sf.statements) visit(statement);
}

/**
 * Normalize only ESM graph/binding syntax. Executable statement lowering remains in
 * the normal parser/compiler lanes; this function deliberately does not pretend that
 * the single-file compiler entry point already accepts modules.
 */
export function normalizeModule(source: string, file = 'input.mjs'): ModuleIr {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    file.endsWith('.ts') || file.endsWith('.mts') ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  const errors = (sf as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
  if (errors.length) {
    const d = errors[0]!, start = d.start ?? 0, lc = sf.getLineAndCharacterOfPosition(start);
    fail('E_PARSE', ts.flattenDiagnosticMessageText(d.messageText, '\n'),
      { file, start, end: start + (d.length ?? 0), line: lc.line + 1, column: lc.character + 1 });
  }
  rejectDeferredModuleSyntax(sf);

  const requests: ModuleRequest[] = [], imports: ModuleImport[] = [], sideEffectImports: SideEffectImport[] = [];
  const localExports: LocalExport[] = [], indirectExports: IndirectExport[] = [], starExports: StarExport[] = [];
  const declaredBindings: string[] = [], uninitializedBindings: string[] = [];
  let defaultExport: DefaultExport | undefined, order = 0, anonymousDefault = 0;

  const request = (specifier: string, n: ts.Node): void => {
    requests.push({ specifier, span: span(sf, n), order: order++ });
  };
  const declare = (name: string, uninitialized = false): void => {
    if (!declaredBindings.includes(name)) declaredBindings.push(name);
    if (uninitialized && !uninitializedBindings.includes(name)) uninitializedBindings.push(name);
  };
  const setDefault = (entry: DefaultExport): void => {
    if (defaultExport) fail('E_MODULE_DUP_EXPORT', 'A module may have only one default export.', entry.span);
    defaultExport = entry;
    localExports.push({ exportName: 'default', localName: entry.localName, span: entry.span });
  };

  for (const s of sf.statements) {
    if (ts.isImportDeclaration(s)) {
      if (s.attributes) failModule(sf, s.attributes, 'Import attributes are not part of this linker lane.');
      const specifier = moduleSpecifier(sf, s.moduleSpecifier, s);
      request(specifier, s);
      if (!s.importClause) { sideEffectImports.push({ specifier, span: span(sf, s) }); continue; }
      if (s.importClause.isTypeOnly) failModule(sf, s.importClause, 'Type-only imports have no runtime binding and are not accepted by the runtime module IR.');
      if (s.importClause.name) imports.push({
        specifier, importName: 'default', localName: s.importClause.name.text, span: span(sf, s.importClause.name),
      });
      const bindings = s.importClause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        imports.push({ specifier, importName: '*namespace*', localName: bindings.name.text, span: span(sf, bindings) });
      } else if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if (element.isTypeOnly) failModule(sf, element, 'Type-only imports are not runtime module bindings.');
          imports.push({
            specifier,
            importName: element.propertyName?.text ?? element.name.text,
            localName: element.name.text,
            span: span(sf, element),
          });
        }
      }
      continue;
    }

    if (ts.isExportDeclaration(s)) {
      if (s.isTypeOnly) failModule(sf, s, 'Type-only exports are not runtime module bindings.');
      if (s.attributes) failModule(sf, s.attributes, 'Export attributes are not part of this linker lane.');
      const specifier = s.moduleSpecifier && moduleSpecifier(sf, s.moduleSpecifier, s);
      if (specifier) request(specifier, s);
      if (!s.exportClause) {
        if (!specifier) failModule(sf, s, 'export * requires a module specifier.');
        starExports.push({ specifier, span: span(sf, s) });
        continue;
      }
      if (ts.isNamespaceExport(s.exportClause)) {
        if (!specifier) failModule(sf, s, 'export * as requires a module specifier.');
        indirectExports.push({
          exportName: s.exportClause.name.text, importName: '*namespace*', specifier, span: span(sf, s.exportClause),
        });
        continue;
      }
      for (const element of s.exportClause.elements) {
        if (element.isTypeOnly) failModule(sf, element, 'Type-only exports are not runtime module bindings.');
        const imported = element.propertyName ? exportedName(element.propertyName) : exportedName(element.name);
        const name = exportedName(element.name);
        if (specifier) indirectExports.push({ exportName: name, importName: imported, specifier, span: span(sf, element) });
        else localExports.push({ exportName: name, localName: imported, span: span(sf, element) });
      }
      continue;
    }

    if (ts.isExportAssignment(s)) {
      if (s.isExportEquals) failModule(sf, s, 'export = is CommonJS/TypeScript interop and is not ESM default export syntax.');
      const localName = `*default:${anonymousDefault++}*`;
      declare(localName, true);
      setDefault({ form: 'expression', localName, span: span(sf, s) });
      continue;
    }

    const exported = hasModifier(s, ts.SyntaxKind.ExportKeyword);
    const isDefault = hasModifier(s, ts.SyntaxKind.DefaultKeyword);
    if (isDefault && !exported) failModule(sf, s, 'default modifier without export is invalid module syntax.');

    if (ts.isVariableStatement(s)) {
      const names = declarationNames(sf, s);
      const lexical = (s.declarationList.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) !== 0;
      for (const name of names) {
        declare(name, lexical);
        if (exported) localExports.push({ exportName: name, localName: name, span: span(sf, s) });
      }
      if (isDefault) failModule(sf, s, 'Variable statements cannot be default exports.');
      continue;
    }

    if (ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s)) {
      const name = s.name?.text, lexical = ts.isClassDeclaration(s);
      if (name) declare(name, lexical);
      if (exported && isDefault) {
        const localName = name ?? `*default:${anonymousDefault++}*`;
        declare(localName, lexical);
        setDefault({ form: 'function_or_class_declaration', localName, span: span(sf, s) });
      } else if (exported) {
        if (!name) failModule(sf, s, 'A non-default exported declaration requires a local name.');
        localExports.push({ exportName: name, localName: name, span: span(sf, s) });
      }
      continue;
    }
  }

  return {
    file, requests, imports, sideEffectImports, localExports, indirectExports, starExports,
    declaredBindings, uninitializedBindings, defaultExport, topLevelThis: hasTopLevelThis(sf),
  };
}
