export type JsType = 'Number' | 'String' | 'Boolean' | 'Null' | 'Undefined' | 'Object' | 'Array';
export type TypeSet = readonly JsType[];
export const PRIMITIVES: TypeSet = ['Boolean', 'Null', 'Number', 'String', 'Undefined'];
export const REFERENCES: TypeSet = ['Array', 'Object'];
export function union(...sets: TypeSet[]): TypeSet { return [...new Set(sets.flat())].sort() as JsType[]; }
export function exactly(types: TypeSet | undefined, type: JsType): boolean { return types?.length === 1 && types[0] === type; }
export function isPrimitiveSet(types: TypeSet): boolean { return types.every(t => PRIMITIVES.includes(t)); }
export function hasReference(types: TypeSet): boolean { return types.some(t => t === 'Object' || t === 'Array'); }
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
