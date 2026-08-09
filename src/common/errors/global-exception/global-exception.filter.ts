import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import {
  DomainError,
  type DomainErrorCode,
  type PublicErrorBody,
} from '../domain.error';
import { RequestContext } from '../../http/request-context/request-context.middleware';

export interface SanitizedErrorLogger {
  error(entry: unknown): void;
}

interface HttpRequestContext {
  readonly method?: unknown;
  readonly originalUrl?: unknown;
  readonly url?: unknown;
  readonly requestId?: unknown;
  readonly headers?: Readonly<Record<string, unknown>>;
}

interface HttpResponseWriter {
  status(statusCode: number): HttpResponseWriter;
  json(body: PublicErrorBody): unknown;
}

interface ErrorMapping {
  readonly status: number;
  readonly code: DomainErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, string | readonly string[]>>;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter<unknown> {
  constructor(
    private readonly logger: SanitizedErrorLogger,
    private readonly context: Pick<RequestContext, 'requestId'>,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<HttpRequestContext>();
    const response = http.getResponse<HttpResponseWriter>();
    const headerRequestId = request.headers?.['x-request-id'];
    const requestId =
      typeof this.context.requestId === 'string' &&
      this.context.requestId.length > 0
        ? this.context.requestId
        : typeof request.requestId === 'string' && request.requestId.length > 0
          ? request.requestId
          : typeof headerRequestId === 'string' && headerRequestId.length > 0
            ? headerRequestId
            : 'unavailable';
    const mapping = mapException(exception);
    const body: PublicErrorBody = {
      success: false,
      message: mapping.message,
      code: mapping.code,
      requestId,
      ...(mapping.details ? { details: mapping.details } : {}),
    };

    this.logger.error({
      event: 'request_failed',
      requestId,
      method: typeof request.method === 'string' ? request.method : 'UNKNOWN',
      path:
        typeof request.originalUrl === 'string'
          ? request.originalUrl
          : typeof request.url === 'string'
            ? request.url
            : 'unknown',
      status: mapping.status,
      code: mapping.code,
      errorType: exception instanceof Error ? exception.name : typeof exception,
    });
    response.status(mapping.status).json(body);
  }
}

function mapException(exception: unknown): ErrorMapping {
  if (exception instanceof DomainError) {
    return {
      status: exception.status,
      code: exception.code,
      message: exception.message,
      ...(exception.details ? { details: exception.details } : {}),
    };
  }
  if (isMalformedJsonError(exception)) {
    return {
      status: HttpStatus.BAD_REQUEST,
      code: 'VALIDATION_FAILED',
      message: 'Malformed JSON request body.',
    };
  }
  if (isPrismaError(exception)) {
    if (readStringProperty(exception, 'code') === 'P2002') {
      return {
        status: HttpStatus.CONFLICT,
        code: 'CONFLICT',
        message: 'The requested change conflicts with existing data.',
      };
    }
    return {
      status: HttpStatus.SERVICE_UNAVAILABLE,
      code: 'DATABASE_UNAVAILABLE',
      message: 'The service is temporarily unavailable.',
    };
  }
  if (isProviderError(exception)) {
    return {
      status: HttpStatus.SERVICE_UNAVAILABLE,
      code: 'PROVIDER_UNAVAILABLE',
      message: 'An external service is temporarily unavailable.',
    };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    return {
      status,
      code: httpStatusCode(status),
      message: httpStatusMessage(status),
    };
  }
  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred.',
  };
}

function isMalformedJsonError(value: unknown): boolean {
  if (value instanceof HttpException && value.cause instanceof SyntaxError) {
    return true;
  }
  if (
    value instanceof HttpException &&
    value.getStatus() === HttpStatus.BAD_REQUEST &&
    /(?:JSON|Unexpected end|Unexpected token)/i.test(value.message)
  ) {
    return true;
  }
  return (
    value instanceof SyntaxError &&
    (readStringProperty(value, 'type') === 'entity.parse.failed' ||
      readNumberProperty(value, 'status') === HttpStatus.BAD_REQUEST)
  );
}

function isPrismaError(value: unknown): boolean {
  const name = readStringProperty(value, 'name');
  return typeof name === 'string' && name.startsWith('PrismaClient');
}

function isProviderError(value: unknown): boolean {
  return readStringProperty(value, 'name') === 'ProviderError';
}

function readStringProperty(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null || !(key in value)) {
    return undefined;
  }
  const property = Reflect.get(value, key);
  return typeof property === 'string' ? property : undefined;
}

function readNumberProperty(value: unknown, key: string): number | undefined {
  if (typeof value !== 'object' || value === null || !(key in value)) {
    return undefined;
  }
  const property = Reflect.get(value, key);
  return typeof property === 'number' ? property : undefined;
}

function httpStatusCode(status: number): DomainErrorCode {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return 'VALIDATION_FAILED';
    case HttpStatus.UNAUTHORIZED:
      return 'AUTHENTICATION_REQUIRED';
    case HttpStatus.FORBIDDEN:
      return 'AUTHORIZATION_DENIED';
    case HttpStatus.NOT_FOUND:
      return 'NOT_FOUND';
    case HttpStatus.CONFLICT:
      return 'CONFLICT';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'RATE_LIMITED';
    case HttpStatus.SERVICE_UNAVAILABLE:
      return 'PROVIDER_UNAVAILABLE';
    default:
      return 'INTERNAL_ERROR';
  }
}

function httpStatusMessage(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return 'The request could not be validated.';
    case HttpStatus.UNAUTHORIZED:
      return 'Authentication is required.';
    case HttpStatus.FORBIDDEN:
      return 'You are not allowed to perform this action.';
    case HttpStatus.NOT_FOUND:
      return 'The requested resource was not found.';
    case HttpStatus.CONFLICT:
      return 'The request conflicts with the current state.';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'Too many requests. Please try again later.';
    case HttpStatus.SERVICE_UNAVAILABLE:
      return 'The service is temporarily unavailable.';
    default:
      return 'An unexpected error occurred.';
  }
}
