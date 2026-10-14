export interface FieldOptions {
  required?: boolean;
  unique?: boolean;
  index?: boolean;
}

export interface Field<T extends string | number | boolean = string | number | boolean, R extends boolean = boolean> {
  readonly kind: "string" | "number" | "boolean";
  readonly required: R;
  readonly unique: boolean;
  readonly index: boolean;
  /** Type-only marker; application values are checked by TypeScript. */
  readonly value?: T;
}

type RequiredOption<O extends FieldOptions> = O extends unknown
  ? "required" extends keyof O
    ? Exclude<O["required"], undefined> | (undefined extends O["required"] ? true : never)
    : true
  : never;
function field<T extends string | number | boolean, O extends FieldOptions>(kind: Field["kind"], options: O): Field<T, RequiredOption<O>> {
  return Object.freeze({ kind, required: options.required ?? true, unique: options.unique ?? false, index: options.index ?? false }) as Field<T, RequiredOption<O>>;
}

export function string<const O extends FieldOptions = {}>(options: O = {} as O): Field<string, RequiredOption<O>> {
  return field("string", options);
}
export function number<const O extends FieldOptions = {}>(options: O = {} as O): Field<number, RequiredOption<O>> {
  return field("number", options);
}
export function boolean<const O extends FieldOptions = {}>(options: O = {} as O): Field<boolean, RequiredOption<O>> {
  return field("boolean", options);
}

export type TableSchema = Record<string, Field>;
export type Schema = Record<string, TableSchema>;
type Value<F> = F extends Field<infer T, boolean> ? T : never;
export type Row<T extends TableSchema> = {
  -readonly [K in keyof T as false extends T[K]["required"] ? never : K]: Value<T[K]>;
} & {
  -readonly [K in keyof T as false extends T[K]["required"] ? K : never]?: Value<T[K]> | undefined;
};
export type Scalar = string | number | boolean | undefined;
export type Values = Record<string, Scalar>;
export type EncodedValues = Record<string, string | null>;

export function encode(value: Scalar, field: Field): string | null {
  if (value === undefined) {
    if (field.required) throw new Error("Required field has no value");
    return null;
  }
  // This is a codec representability check, not a second input type checker.
  if (field.kind === "number" && !Number.isFinite(value)) throw new Error("Only finite numbers can be stored");
  if (field.kind === "boolean") return value ? "true" : "false";
  if (field.kind === "number" && Object.is(value, -0)) return "-0";
  return String(value);
}

export function decode(value: unknown, field: Field): Scalar {
  if (value === null && !field.required) return undefined;
  if (typeof value !== "string") throw new Error("Malformed encoded scalar");
  if (field.kind === "string") return value;
  if (field.kind === "boolean") {
    if (value === "true") return true;
    if (value === "false") return false;
    throw new Error("Malformed encoded boolean");
  }
  const result = Number(value);
  if (!Number.isFinite(result) || encode(result, field) !== value) throw new Error("Malformed encoded number");
  return result;
}

export function indexKey(value: Scalar, field: Field): string {
  // Equality uses JavaScript === semantics, so -0 and 0 share an index bucket.
  return value === undefined ? "undefined" : JSON.stringify(encode(value === 0 ? 0 : value, field));
}

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function sameKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  const expected = new Set(keys);
  return actual.length === expected.size && actual.every(key => expected.has(key));
}
export function canonicalSchema(schema: Schema): Schema {
  const result: Schema = Object.create(null);
  for (const table of Object.keys(schema).sort()) {
    if (table === "push" || table === "write") throw new Error(`Table name conflicts with database operation: ${table}`);
    const fields: TableSchema = Object.create(null);
    for (const name of Object.keys(schema[table]).sort()) {
      const source = schema[table][name];
      if (!["string", "number", "boolean"].includes(source.kind)) throw new Error("Unsupported schema scalar");
      fields[name] = Object.freeze({ kind: source.kind, required: source.required, unique: source.unique, index: source.index });
    }
    result[table] = Object.freeze(fields);
  }
  return Object.freeze(result);
}
