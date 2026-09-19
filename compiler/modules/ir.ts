import type { Span } from '../diagnostics/index.js';

export interface ModuleRequest {
  specifier: string;
  span: Span;
  order: number;
}

export interface ModuleImport {
  specifier: string;
  importName: string | '*namespace*';
  localName: string;
  span: Span;
}

export interface SideEffectImport {
  specifier: string;
  span: Span;
}

export interface LocalExport {
  exportName: string;
  localName: string;
  span: Span;
}

export interface IndirectExport {
  exportName: string;
  importName: string | '*namespace*';
  specifier: string;
  span: Span;
}

export interface StarExport {
  specifier: string;
  span: Span;
}

export interface DefaultExport {
  form: 'expression' | 'function_or_class_declaration';
  localName: string;
  span: Span;
}

export interface ModuleIr {
  file: string;
  requests: ModuleRequest[];
  imports: ModuleImport[];
  sideEffectImports: SideEffectImport[];
  localExports: LocalExport[];
  indirectExports: IndirectExport[];
  starExports: StarExport[];
  declaredBindings: string[];
  defaultExport?: DefaultExport;
  topLevelThis: boolean;
}
