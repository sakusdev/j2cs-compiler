export type JsType = 'Number' | 'String' | 'Boolean' | 'Null' | 'Undefined';
export type TypeSet = readonly JsType[];
export const PRIMITIVES: TypeSet = ['Boolean', 'Null', 'Number', 'String', 'Undefined'];
export function union(...sets: TypeSet[]): TypeSet { return [...new Set(sets.flat())].sort(); }
export function exactly(types: TypeSet | undefined, type: JsType): boolean { return types?.length === 1 && types[0] === type; }
export function literalType(value: number | string | boolean | null): TypeSet {
  return [value === null ? 'Null' : typeof value === 'number' ? 'Number' : typeof value === 'string' ? 'String' : 'Boolean'];
}
/** Facts carry evidence, not rule-specific truth switches. Missing facts mean unknown. */
export interface Fact { value: string | number | boolean | readonly string[]; evidence: string }
export type FactModel = ReadonlyMap<string, Fact>;
export class Facts extends Map<string, Fact> {
  prove(key: string, value: Fact['value'], evidence: string): this { this.set(key, { value, evidence }); return this; }
  type(key: string, types: TypeSet, evidence: string): this {
    this.delete(`${key}.type`);
    this.prove(`${key}.types`, types, evidence);
    if (types.length === 1) this.prove(`${key}.type`, types[0]!, evidence);
    return this;
  }
}
