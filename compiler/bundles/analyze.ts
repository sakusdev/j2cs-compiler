import ts from 'typescript';
import type {
  BundleAnalysis, BundleDiagnostic, BundleFlavor, BundleHost, DynamicImportFact,
  PreloadFact, SourceMapProvenance, WebpackChunkFact,
} from './model.js';

export interface AnalyzeBundleOptions {
  fileName?: string;
  host?: BundleHost;
}

function scriptKind(fileName: string): ts.ScriptKind {
  if (fileName.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (fileName.endsWith('.ts')) return ts.ScriptKind.TS;
  if (fileName.endsWith('.jsx')) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

function declaredNames(root: ts.Node): Set<string> {
  const names = new Set<string>();
  const addName = (name: ts.BindingName | ts.DeclarationName | undefined) => {
    if (name && ts.isIdentifier(name)) names.add(name.text);
  };
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node)) addName(node.name);
    else if (ts.isParameter(node)) addName(node.name);
    else if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) addName(node.name);
    else if (ts.isImportClause(node)) addName(node.name);
    else if (ts.isImportSpecifier(node) || ts.isNamespaceImport(node)) addName(node.name);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return names;
}

function stringLiteral(node: ts.Expression | undefined): string | undefined {
  return node && ts.isStringLiteralLike(node) ? node.text : undefined;
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false);
}

function literalId(node: ts.Expression): string | undefined {
  if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text;
  return undefined;
}

function containsDynamicImport(node: ts.Node): boolean {
  let found = false;
  const visit = (child: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(child) && child.expression.kind === ts.SyntaxKind.ImportKeyword) {
      found = true;
      return;
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

function sourceMapDirective(source: string): SourceMapProvenance | undefined {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source);
  let result: SourceMapProvenance | undefined;
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token !== ts.SyntaxKind.SingleLineCommentTrivia && token !== ts.SyntaxKind.MultiLineCommentTrivia) continue;
    const raw = scanner.getTokenText().trim();
    const bodies = raw.startsWith('//') ? raw.slice(2).trim() : raw.startsWith('/*') ? raw.slice(2, -2).trim() : raw;
    if (!bodies.startsWith('#') && !bodies.startsWith('@')) continue;
    const directive = bodies.slice(1).trim();
    const prefix = 'sourceMappingURL=';
    if (!directive.startsWith(prefix)) continue;
    const url = directive.slice(prefix.length).trim();
    if (url) result = { url, kind: url.startsWith('data:') ? 'data' : 'external', offset: scanner.getTokenPos() };
  }
  return result;
}

function webpackChunk(call: ts.CallExpression, diagnostics: BundleDiagnostic[]): WebpackChunkFact | undefined {
  if (!ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== 'push' || call.arguments.length !== 1) return undefined;
  const payload = call.arguments[0];
  if (!payload || !ts.isArrayLiteralExpression(payload) || payload.elements.length < 2) return undefined;
  const chunkList = payload.elements[0], factories = payload.elements[1];
  if (!chunkList || !ts.isArrayLiteralExpression(chunkList) || !factories || !ts.isObjectLiteralExpression(factories)) return undefined;
  const chunkIds: string[] = [];
  for (const element of chunkList.elements) {
    if (ts.isSpreadElement(element)) {
      diagnostics.push({ code: 'BUNDLE_WEBPACK_DYNAMIC_CHUNK_ID', severity: 'error', message: 'Spread chunk IDs are not statically owned by this lane.', offset: element.getStart() });
      continue;
    }
    const id = literalId(element);
    if (id === undefined) diagnostics.push({ code: 'BUNDLE_WEBPACK_DYNAMIC_CHUNK_ID', severity: 'error', message: 'Webpack-like chunk ID must be a literal for deterministic planning.', offset: element.getStart() });
    else chunkIds.push(id);
  }
  let moduleFactoryCount = 0;
  for (const property of factories.properties) {
    if (ts.isPropertyAssignment(property) && (ts.isArrowFunction(property.initializer) || ts.isFunctionExpression(property.initializer))) moduleFactoryCount++;
    else if (ts.isMethodDeclaration(property)) moduleFactoryCount++;
  }
  if (!moduleFactoryCount) return undefined;
  return { chunkIds, moduleFactoryCount, offset: call.getStart() };
}

function preloadFact(call: ts.CallExpression): PreloadFact | undefined {
  const loader = call.arguments.find(arg => (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) && containsDynamicImport(arg));
  const deps = call.arguments.find(arg => ts.isArrayLiteralExpression(arg) && arg.elements.every(element => ts.isStringLiteralLike(element)));
  if (!loader || !deps || !ts.isArrayLiteralExpression(deps)) return undefined;
  return { dependencies: deps.elements.map(element => (element as ts.StringLiteralLike).text), offset: call.getStart() };
}

export function analyzeBundle(source: string, options: AnalyzeBundleOptions = {}): BundleAnalysis {
  const fileName = options.fileName ?? 'bundle.js';
  const host = options.host ?? 'electron-renderer';
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKind(fileName));
  const shadowed = declaredNames(sourceFile);
  const parseDiagnostics = (sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  const diagnostics: BundleDiagnostic[] = parseDiagnostics.map(diagnostic => ({
    code: 'BUNDLE_PARSE',
    severity: 'error',
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    offset: diagnostic.start,
  }));
  const dynamicImports: DynamicImportFact[] = [];
  const webpackChunks: WebpackChunkFact[] = [];
  const preloads: PreloadFact[] = [];
  const reactRegisteredSymbols = new Set<string>();
  let usesObjectAssign = false, usesPromiseResolve = false, esmSyntax = false;

  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) ||
      ts.isExportDeclaration(statement) ||
      ts.isExportAssignment(statement) ||
      hasExportModifier(statement)
    ) esmSyntax = true;
  }

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        dynamicImports.push({ specifier: stringLiteral(node.arguments[0]), offset: node.getStart() });
      }
      const chunk = webpackChunk(node, diagnostics);
      if (chunk) webpackChunks.push(chunk);
      const preload = preloadFact(node);
      if (preload) preloads.push(preload);

      if (ts.isPropertyAccessExpression(node.expression)) {
        const owner = node.expression.expression, member = node.expression.name.text;
        if (ts.isIdentifier(owner) && owner.text === 'Symbol' && member === 'for') {
          const key = stringLiteral(node.arguments[0]);
          if (key?.startsWith('react.')) {
            if (shadowed.has('Symbol')) diagnostics.push({
              code: 'BUNDLE_REACT_SYMBOL_SHADOWED', severity: 'error',
              message: 'Symbol is lexically shadowed; canonical Symbol.for proof is unavailable.', offset: node.getStart(),
            });
            else reactRegisteredSymbols.add(key);
          }
        }
        if (ts.isIdentifier(owner) && owner.text === 'Object' && member === 'assign') {
          if (shadowed.has('Object')) diagnostics.push({
            code: 'BUNDLE_OBJECT_ASSIGN_SHADOWED', severity: 'error',
            message: 'Object is lexically shadowed; Object.assign cannot use the canonical runtime rule.', offset: node.getStart(),
          });
          else usesObjectAssign = true;
        }
        if (ts.isIdentifier(owner) && owner.text === 'Promise' && member === 'resolve') {
          if (shadowed.has('Promise')) diagnostics.push({
            code: 'BUNDLE_PROMISE_SHADOWED', severity: 'error',
            message: 'Promise is lexically shadowed; Promise.resolve proof is unavailable.', offset: node.getStart(),
          });
          else usesPromiseResolve = true;
        }
      }
      if (ts.isIdentifier(node.expression) && (node.expression.text === 'eval' || node.expression.text === 'Function')) {
        diagnostics.push({ code: 'BUNDLE_DYNAMIC_CODE', severity: 'error', message: 'Dynamic code generation is outside this bundle lane and remains fail-closed.', offset: node.getStart() });
      }
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Function') {
      diagnostics.push({ code: 'BUNDLE_DYNAMIC_CODE', severity: 'error', message: 'new Function is outside this bundle lane and remains fail-closed.', offset: node.getStart() });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const required = new Set<string>();
  if (esmSyntax || dynamicImports.length || webpackChunks.length) {
    required.add('modules.esm.evaluate-once');
    required.add('modules.esm.dependency-evaluation-order');
  }
  if (dynamicImports.length && host === 'node') required.add('node.module-resolution.dynamic-import');
  if (preloads.length) required.add('async.promise.then');
  if (usesPromiseResolve) required.add('async.promise.resolve');
  if (reactRegisteredSymbols.size) required.add('symbol.for.primitive-key');
  if (usesObjectAssign) required.add('object.assign');

  const deferred = new Set<string>();
  if (webpackChunks.length) deferred.add('module-factory-lowering');
  if (dynamicImports.length && host !== 'node') deferred.add('dynamic-import-host-resolution');
  if (preloads.length) deferred.add('promise-runtime-integration');

  const flavors = new Set<BundleFlavor>();
  if (webpackChunks.length) flavors.add('webpack-chunk');
  if (preloads.length) flavors.add('vite-preload');
  if (esmSyntax || dynamicImports.length) flavors.add('esm-code-split');
  if (!flavors.size) flavors.add('unknown');
  const errors = diagnostics.some(diagnostic => diagnostic.severity === 'error');
  return {
    host,
    flavors: [...flavors],
    esmSyntax,
    dynamicImports,
    webpackChunks,
    preloads,
    reactRegisteredSymbols: [...reactRegisteredSymbols].sort(),
    usesObjectAssign,
    usesPromiseResolve,
    sourceMap: sourceMapDirective(source),
    requiredRuleIds: [...required].sort(),
    deferredCapabilities: [...deferred].sort(),
    diagnostics,
    canExecuteWithoutSiblingIntegration: !errors && deferred.size === 0,
  };
}
