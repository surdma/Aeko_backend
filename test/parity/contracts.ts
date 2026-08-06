export type SafeNumeric = string | bigint;

export interface EffectRecord {
  readonly kind: 'database' | 'provider' | 'blockchain';
  readonly name: string;
  readonly values: Readonly<Record<string, unknown>>;
}

export interface RuntimeEventObservation {
  readonly event: string;
  readonly payload: unknown;
  readonly acknowledgement?: unknown;
}

export interface RuntimeObservation {
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
  readonly cookies?: readonly string[];
  readonly events?: readonly RuntimeEventObservation[];
  readonly effects: readonly EffectRecord[];
}

export interface BaseParityCase {
  readonly id: string;
  readonly description: string;
  readonly intentionalExceptions?: readonly string[];
  readonly dynamicPaths?: readonly string[];
}

export interface HttpParityCase extends BaseParityCase {
  readonly kind: 'http' | 'webhook';
  readonly method: string;
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

export interface SocketParityCase extends BaseParityCase {
  readonly kind: 'socket';
  readonly namespace: string;
  readonly event: string;
  readonly payload: unknown;
}

export interface EffectParityCase extends BaseParityCase {
  readonly kind: 'job' | 'provider' | 'database' | 'blockchain';
  readonly operation: string;
  readonly inputs: Readonly<Record<string, unknown>>;
}

export type ParityCase = HttpParityCase | SocketParityCase | EffectParityCase;

export interface ParityDifference {
  readonly path: string;
  readonly legacy: unknown;
  readonly nest: unknown;
  readonly intentional: boolean;
}

export interface ParityResult {
  readonly caseId: string;
  readonly matched: boolean;
  readonly legacy: RuntimeObservation;
  readonly nest: RuntimeObservation;
  readonly differences: readonly ParityDifference[];
}
