import { createHash } from 'node:crypto';
import type {
  EffectRecord,
  RuntimeEventObservation,
  RuntimeObservation,
} from './contracts.js';

const sensitiveKey =
  /(?:authorization|cookie|email|name|password|phone|secret|token|private|credential)/iu;
const sensitiveText =
  /(?:\bBearer\s+\S+|password\s*[=:]|postgres(?:ql)?:\/\/[^\s@]+@|\b(?:sk|pk|api)[-_][A-Za-z0-9_-]{12,}\b)/iu;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stableSerializable(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) return value.map((entry) => stableSerializable(entry, seen));
  if (!isRecord(value)) return String(value);

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableSerializable(value[key], seen)]),
  );
}

function sensitiveFingerprint(value: unknown): string {
  const serialized = JSON.stringify(stableSerializable(value, new WeakSet<object>()));
  const digest = createHash('sha256')
    .update(serialized ?? String(value))
    .digest('hex')
    .slice(0, 12);
  return `[REDACTED:${digest}]`;
}

function shouldFingerprint(value: unknown, key: string, path: string): boolean {
  if (path.startsWith('$.cookies.') && typeof value === 'string') return true;
  if (sensitiveKey.test(key) && !Array.isArray(value)) return true;
  return typeof value === 'string' && sensitiveText.test(value);
}

export function normalizeUnknown(
  value: unknown,
  path = '$',
  dynamicPaths: ReadonlySet<string> = new Set<string>(),
  key = '',
  seen: WeakSet<object> = new WeakSet<object>(),
): unknown {
  if (dynamicPaths.has(path)) return '<dynamic>';
  if (shouldFingerprint(value, key, path)) return sensitiveFingerprint(value);
  if (typeof value === 'bigint') return value.toString();
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      normalizeUnknown(entry, `${path}.${index}`, dynamicPaths, String(index), seen),
    );
  }
  if (!isRecord(value)) return String(value);

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((entryKey) => [
        entryKey,
        normalizeUnknown(
          value[entryKey],
          `${path}.${entryKey}`,
          dynamicPaths,
          entryKey,
          seen,
        ),
      ]),
  );
}

function normalizeStringRecord(
  value: Readonly<Record<string, string>>,
  path: string,
  dynamicPaths: ReadonlySet<string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      const normalized = normalizeUnknown(entry, `${path}.${key}`, dynamicPaths, key);
      return [key, typeof normalized === 'string' ? normalized : String(normalized)];
    }),
  );
}

function normalizeUnknownRecord(
  value: Readonly<Record<string, unknown>>,
  path: string,
  dynamicPaths: ReadonlySet<string>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      normalizeUnknown(entry, `${path}.${key}`, dynamicPaths, key),
    ]),
  );
}

function normalizeEvent(
  event: RuntimeEventObservation,
  index: number,
  dynamicPaths: ReadonlySet<string>,
): RuntimeEventObservation {
  const basePath = `$.events.${index}`;
  return {
    event: event.event,
    payload: normalizeUnknown(event.payload, `${basePath}.payload`, dynamicPaths),
    ...(event.acknowledgement === undefined
      ? {}
      : {
          acknowledgement: normalizeUnknown(
            event.acknowledgement,
            `${basePath}.acknowledgement`,
            dynamicPaths,
          ),
        }),
  };
}

function normalizeEffect(
  effect: EffectRecord,
  index: number,
  dynamicPaths: ReadonlySet<string>,
): EffectRecord {
  return {
    kind: effect.kind,
    name: effect.name,
    values: normalizeUnknownRecord(effect.values, `$.effects.${index}.values`, dynamicPaths),
  };
}

export function normalizeObservation(
  observation: RuntimeObservation,
  dynamicPathValues: readonly string[] = [],
): RuntimeObservation {
  const dynamicPaths = new Set(dynamicPathValues);

  return {
    ...(observation.status === undefined ? {} : { status: observation.status }),
    ...(observation.headers === undefined
      ? {}
      : { headers: normalizeStringRecord(observation.headers, '$.headers', dynamicPaths) }),
    ...(observation.body === undefined
      ? {}
      : { body: normalizeUnknown(observation.body, '$.body', dynamicPaths) }),
    ...(observation.cookies === undefined
      ? {}
      : {
          cookies: observation.cookies.map((cookie, index) =>
            String(normalizeUnknown(cookie, `$.cookies.${index}`, dynamicPaths, 'cookie')),
          ),
        }),
    ...(observation.events === undefined
      ? {}
      : {
          events: observation.events.map((event, index) =>
            normalizeEvent(event, index, dynamicPaths),
          ),
        }),
    effects: observation.effects.map((effect, index) =>
      normalizeEffect(effect, index, dynamicPaths),
    ),
  };
}

export class EffectRecorder {
  public readonly effects: EffectRecord[] = [];

  public record(effect: EffectRecord): void {
    this.effects.push({
      kind: effect.kind,
      name: effect.name,
      values: normalizeUnknownRecord(effect.values, '$.effect.values', new Set<string>()),
    });
  }
}
