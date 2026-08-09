import { HttpStatus } from '@nestjs/common';

export type DomainErrorCode =
  | 'VALIDATION_FAILED'
  | 'AUTHENTICATION_REQUIRED'
  | 'AUTHORIZATION_DENIED'
  | 'TWO_FACTOR_REQUIRED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'DATABASE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export interface PublicErrorBody {
  readonly success: false;
  readonly message: string;
  readonly code: DomainErrorCode;
  readonly requestId: string;
  readonly details?: Readonly<Record<string, string | readonly string[]>>;
}

const statusByCode: Readonly<Record<DomainErrorCode, HttpStatus>> = {
  VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
  AUTHENTICATION_REQUIRED: HttpStatus.UNAUTHORIZED,
  AUTHORIZATION_DENIED: HttpStatus.FORBIDDEN,
  TWO_FACTOR_REQUIRED: HttpStatus.FORBIDDEN,
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
    readonly details?: Readonly<Record<string, string | readonly string[]>>,
  ) {
    super(message);
    this.name = 'DomainError';
    this.status = statusByCode[code];
  }
}
