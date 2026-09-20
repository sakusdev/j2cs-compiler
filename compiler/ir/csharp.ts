/** Typed emission IR. No raw source fragments, templates, parser nodes, dynamic or CLR object. */
export type Repr = 'value' | 'number' | 'string' | 'boolean' | 'environment' | 'integer';

export type CsExpr =
  | { kind: 'literal'; repr: 'number'; value: number }
  | { kind: 'literal'; repr: 'integer'; value: number }
  | { kind: 'literal'; repr: 'string'; value: string }
  | { kind: 'literal'; repr: 'boolean'; value: boolean }
  | { kind: 'environment'; repr: 'environment' }
  | { kind: 'member'; repr: Repr; name: 'JsNull.Value' | 'JsUndefined.Value' | 'double.NaN' | 'double.PositiveInfinity' }
  | { kind: 'call'; repr: Repr; target: string; args: CsExpr[] }
  | { kind: 'functionCreate'; repr: 'value'; templateId: number }
  | { kind: 'functionCall'; repr: 'value'; callee: CsExpr; templateId: number; body: string; params: number[]; args: CsExpr[] }
  | { kind: 'unbox'; repr: 'number' | 'string' | 'boolean'; value: CsExpr }
  | { kind: 'box'; repr: 'value'; value: CsExpr }
  | { kind: 'binary'; repr: 'number' | 'boolean'; op: string; left: CsExpr; right: CsExpr }
  | { kind: 'unary'; repr: 'number' | 'boolean'; op: '-' | '!'; value: CsExpr };

export type CsStatement =
  | { kind: 'binding'; id: number; initializer: CsExpr }
  | { kind: 'expression'; expression: CsExpr }
  | { kind: 'block'; body: CsStatement[] }
  | { kind: 'if'; condition: CsExpr; then: CsStatement; otherwise?: CsStatement }
  | { kind: 'while'; condition: CsExpr; body: CsStatement }
  | { kind: 'doWhile'; body: CsStatement; condition: CsExpr }
  | { kind: 'for'; condition?: CsExpr; update?: CsExpr; body: CsStatement }
  | { kind: 'break' }
  | { kind: 'continue' }
  | { kind: 'return'; value: CsExpr };

export interface CsFunction { name: string; body: CsStatement[] }
export interface CsProgram { body: CsStatement[]; functions: CsFunction[] }

export function box(value: CsExpr): CsExpr {
  if (value.repr === 'value') return value;
  if (value.repr === 'environment' || value.repr === 'integer') throw new Error('Cannot box non-JavaScript IR representation');
  return { kind: 'box', repr: 'value', value };
}
export function unbox(value: CsExpr, repr: 'number' | 'string' | 'boolean'): CsExpr {
  return { kind: 'unbox', repr, value };
}
