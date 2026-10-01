export interface FieldOptions {
  required?: boolean;
  unique?: boolean;
  index?: boolean;
}
export interface Field<K extends 'string' | 'number' | 'boolean' = 'string' | 'number' | 'boolean', R extends boolean = boolean> {
  readonly kind: K;
  readonly required: R;
  readonly unique: boolean;
  readonly index: boolean;
}
type RequiredOption<O> = O extends { required: false } ? false : true;
function field<K extends Field['kind'], O extends FieldOptions>(kind: K, options: O): Field<K, RequiredOption<O>> {
  return Object.freeze({ kind, required: options.required !== false, unique: options.unique === true, index: options.index === true }) as Field<K, RequiredOption<O>>;
}
export function string<const O extends FieldOptions = {}>(options: O = {} as O): Field<'string', RequiredOption<O>> { return field('string', options); }
export function number<const O extends FieldOptions = {}>(options: O = {} as O): Field<'number', RequiredOption<O>> { return field('number', options); }
export function boolean<const O extends FieldOptions = {}>(options: O = {} as O): Field<'boolean', RequiredOption<O>> { return field('boolean', options); }
export type TableSchema = Record<string, Field>;
export type Schema = Record<string, TableSchema>;
type Scalar<F extends Field> = { string: string; number: number; boolean: boolean }[F['kind']];
export type Row<T extends TableSchema> = {
  [K in keyof T as T[K]['required'] extends false ? never : K]: Scalar<T[K]>;
} & {
  [K in keyof T as T[K]['required'] extends false ? K : never]?: Scalar<T[K]> | undefined;
};
export type Value = string | number | boolean | undefined;
export type Values = Record<string, Value>;
export type Encoded = string | null;
export function encode(value: Value): Encoded {
  if (value === undefined) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Cannot encode a non-finite number');
    return Object.is(value, -0) ? '-0' : String(value);
  }
  return String(value);
}
export function decode(value: unknown, field: Field): Value {
  if (value === null && !field.required) return undefined;
  if (typeof value !== 'string') throw new Error('Malformed stored scalar');
  if (field.kind === 'string') return value;
  if (field.kind === 'boolean') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  } else {
    const n = Number(value);
    if (Number.isFinite(n) && encode(n) === value) return n;
  }
  throw new Error('Malformed stored scalar');
}
// Equality follows JavaScript ===, including equivalence of -0 and 0.
export function key(value: Value): string { return value === undefined ? 'undefined' : JSON.stringify(value); }
export function record(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
export function sameKeys(a: object, b: object): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b, k));
}
export function normalizeSchema(schema: Schema): Schema {
  if (!record(schema)) throw new Error('Invalid schema');
  const result: Schema = Object.create(null);
  for (const table of Object.keys(schema).sort()) {
    if (table === 'push' || table === 'write') throw new Error(`Reserved table name: ${table}`);
    if (!record(schema[table])) throw new Error('Invalid table schema');
    const fields: TableSchema = Object.create(null);
    for (const name of Object.keys(schema[table]).sort()) {
      const f = schema[table][name];
      if (!f || !['string', 'number', 'boolean'].includes(f.kind) || typeof f.required !== 'boolean' || typeof f.unique !== 'boolean' || typeof f.index !== 'boolean') throw new Error('Invalid field definition');
      fields[name] = Object.freeze({ kind: f.kind, required: f.required, unique: f.unique, index: f.index });
    }
    result[table] = Object.freeze(fields);
  }
  return Object.freeze(result);
}
