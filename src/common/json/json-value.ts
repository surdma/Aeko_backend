export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export const isJsonObject = (
  value: JsonValue | undefined,
): value is Readonly<Record<string, JsonValue>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const asJsonObject = (
  value: JsonValue | undefined,
): Readonly<Record<string, JsonValue>> => (isJsonObject(value) ? value : {});

export const asStringArray = (
  value: JsonValue | undefined,
): readonly string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];

/**
 * Prisma returns `Json` columns as arbitrary values. Normalizing here keeps
 * `undefined`, functions, and cyclic references out of every response body.
 */
export const toJsonValue = (value: unknown): JsonValue => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return Object.freeze(value.map(toJsonValue));
  if (typeof value === 'object') {
    const entries = Object.entries(value).flatMap(([key, entry]) =>
      typeof entry === 'function' ? [] : [[key, toJsonValue(entry)] as const],
    );
    return Object.freeze(Object.fromEntries(entries));
  }
  return null;
};
