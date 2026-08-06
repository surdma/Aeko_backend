import type {
  BaseParityCase,
  HttpParityCase,
  ParityDifference,
  ParityResult,
  RuntimeObservation,
} from './contracts.js';
import { normalizeObservation } from './effect-recorder.js';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function flattenDifferences(
  legacy: unknown,
  nest: unknown,
  path = '$',
): ParityDifference[] {
  if (Object.is(legacy, nest)) return [];

  if (Array.isArray(legacy) && Array.isArray(nest)) {
    const length = Math.max(legacy.length, nest.length);
    return Array.from({ length }, (_, index) =>
      flattenDifferences(legacy[index], nest[index], `${path}.${index}`),
    ).flat();
  }

  if (isRecord(legacy) && isRecord(nest)) {
    const keys = new Set([...Object.keys(legacy), ...Object.keys(nest)]);
    return [...keys]
      .sort()
      .flatMap((key) => flattenDifferences(legacy[key], nest[key], `${path}.${key}`));
  }

  return [{ path, legacy, nest, intentional: false }];
}

export function compareObservations(
  parityCase: Pick<
    BaseParityCase,
    'id' | 'intentionalExceptions' | 'dynamicPaths'
  >,
  legacy: RuntimeObservation,
  nest: RuntimeObservation,
): ParityResult {
  const normalizedLegacy = normalizeObservation(legacy, parityCase.dynamicPaths);
  const normalizedNest = normalizeObservation(nest, parityCase.dynamicPaths);
  const differences = flattenDifferences(normalizedLegacy, normalizedNest).map((difference) => ({
    ...difference,
    intentional: parityCase.intentionalExceptions?.includes(difference.path) ?? false,
  }));

  return {
    caseId: parityCase.id,
    matched: differences.every((difference) => difference.intentional),
    legacy: normalizedLegacy,
    nest: normalizedNest,
    differences,
  };
}

export async function observeHttp(
  baseUrl: string,
  parityCase: HttpParityCase,
): Promise<RuntimeObservation> {
  const response = await fetch(new URL(parityCase.path, baseUrl), {
    method: parityCase.method,
    headers: { 'content-type': 'application/json', ...parityCase.headers },
    body: parityCase.body === undefined ? undefined : JSON.stringify(parityCase.body),
  });
  const contentType = response.headers.get('content-type') ?? '';

  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: contentType.includes('json') ? await response.json() : await response.text(),
    cookies: response.headers.getSetCookie(),
    effects: [],
  };
}

export async function runHttpParity(
  parityCase: HttpParityCase,
  legacyBaseUrl: string,
  nestBaseUrl: string,
): Promise<ParityResult> {
  const [legacy, nest] = await Promise.all([
    observeHttp(legacyBaseUrl, parityCase),
    observeHttp(nestBaseUrl, parityCase),
  ]);
  return compareObservations(parityCase, legacy, nest);
}
