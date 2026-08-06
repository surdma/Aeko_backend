import type { ParityResult, RuntimeObservation, SocketParityCase } from './contracts.js';
import { compareObservations } from './http-runner.js';

export type SocketObserver = (
  parityCase: SocketParityCase,
) => Promise<RuntimeObservation>;

export async function runSocketParity(
  parityCase: SocketParityCase,
  observeLegacy: SocketObserver,
  observeNest: SocketObserver,
): Promise<ParityResult> {
  const [legacy, nest] = await Promise.all([
    observeLegacy(parityCase),
    observeNest(parityCase),
  ]);
  return compareObservations(parityCase, legacy, nest);
}
