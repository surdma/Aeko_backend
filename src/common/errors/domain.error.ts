import { HttpStatus } from '@nestjs/common';

import type { JsonValue } from '../json/json-value';

export type DomainErrorCode =
  | 'VALIDATION_FAILED'
  | 'AUTHENTICATION_REQUIRED'
  | 'AUTHORIZATION_DENIED'
  | 'TWO_FACTOR_REQUIRED'
  | 'PAYMENT_REQUIRED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'DATABASE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

/**
 * Structured context a client may act on — the paid-community paywall reads
 * its price out of here. Values are JSON so a nested object survives.
 */
export type ErrorDetails = Readonly<Record<string, JsonValue>>;

export interface PublicErrorBody {
  readonly success: false;
  readonly message: string;
  readonly code: DomainErrorCode;
  readonly requestId: string;
  readonly details?: ErrorDetails;
}

const statusByCode: Readonly<Record<DomainErrorCode, HttpStatus>> = {
  VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
  AUTHENTICATION_REQUIRED: HttpStatus.UNAUTHORIZED,
  AUTHORIZATION_DENIED: HttpStatus.FORBIDDEN,
  TWO_FACTOR_REQUIRED: HttpStatus.FORBIDDEN,
  PAYMENT_REQUIRED: HttpStatus.PAYMENT_REQUIRED,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  CONFLICT: HttpStatus.CONFLICT,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  PROVIDER_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  DATABASE_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  INTERNAL_ERROR: HttpStatus.INTERNAL_SERVER_ERROR,
};

export class DomainError extends Error {
  readonly status: HttpStatus;

  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly details?: ErrorDetails,
  ) {
    super(message);
    this.name = 'DomainError';
    this.status = statusByCode[code];
  }
}
