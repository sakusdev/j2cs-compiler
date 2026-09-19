export interface Span { file: string; start: number; end: number; line: number; column: number }
export interface Diagnostic { code: string; message: string; span?: Span; details?: unknown }
export class CompileError extends Error {
  constructor(public readonly diagnostic: Diagnostic) { super(diagnostic.message); this.name = 'CompileError'; }
}
export function fail(code: string, message: string, span?: Span, details?: unknown): never {
  throw new CompileError({ code, message, span, details });
}
export function formatDiagnostic(d: Diagnostic): string {
  const at = d.span ? `${d.span.file}:${d.span.line}:${d.span.column}: ` : '';
  return `${at}${d.code}: ${d.message}`;
}
