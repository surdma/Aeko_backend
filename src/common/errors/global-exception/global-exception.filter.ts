import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import {
  DomainError,
  type DomainErrorCode,
  type ErrorDetails,
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
  readonly details?: ErrorDetails;
}

const statusCode = {
  badRequest: 400,
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
  conflict: 409,
  unprocessableEntity: 422,
  tooManyRequests: 429,
  serviceUnavailable: 503,
  internalServerError: 500,
} as const;

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
      status: statusCode.badRequest,
      code: 'VALIDATION_FAILED',
      message: 'Malformed JSON request body.',
    };
  }
  if (isPrismaError(exception)) {
    if (readStringProperty(exception, 'code') === 'P2002') {
      return {
        status: statusCode.conflict,
        code: 'CONFLICT',
        message: 'The requested change conflicts with existing data.',
      };
    }
    return {
      status: statusCode.serviceUnavailable,
      code: 'DATABASE_UNAVAILABLE',
      message: 'The service is temporarily unavailable.',
    };
  }
  if (isProviderError(exception)) {
    return {
      status: statusCode.serviceUnavailable,
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
    status: statusCode.internalServerError,
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
    value.getStatus() === statusCode.badRequest &&
    /(?:JSON|Unexpected end|Unexpected token)/i.test(value.message)
  ) {
    return true;
  }
  return (
    value instanceof SyntaxError &&
    (readStringProperty(value, 'type') === 'entity.parse.failed' ||
      readNumberProperty(value, 'status') === statusCode.badRequest)
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
  const property: unknown = Reflect.get(value, key);
  return typeof property === 'string' ? property : undefined;
}

function readNumberProperty(value: unknown, key: string): number | undefined {
  if (typeof value !== 'object' || value === null || !(key in value)) {
    return undefined;
  }
  const property: unknown = Reflect.get(value, key);
  return typeof property === 'number' ? property : undefined;
}

function httpStatusCode(status: number): DomainErrorCode {
  switch (status) {
    case statusCode.badRequest:
    case statusCode.unprocessableEntity:
      return 'VALIDATION_FAILED';
    case statusCode.unauthorized:
      return 'AUTHENTICATION_REQUIRED';
    case statusCode.forbidden:
      return 'AUTHORIZATION_DENIED';
    case statusCode.notFound:
      return 'NOT_FOUND';
    case statusCode.conflict:
      return 'CONFLICT';
    case statusCode.tooManyRequests:
      return 'RATE_LIMITED';
    case statusCode.serviceUnavailable:
      return 'PROVIDER_UNAVAILABLE';
    default:
      return 'INTERNAL_ERROR';
  }
}

function httpStatusMessage(status: number): string {
  switch (status) {
    case statusCode.badRequest:
    case statusCode.unprocessableEntity:
      return 'The request could not be validated.';
    case statusCode.unauthorized:
      return 'Authentication is required.';
    case statusCode.forbidden:
      return 'You are not allowed to perform this action.';
    case statusCode.notFound:
      return 'The requested resource was not found.';
    case statusCode.conflict:
      return 'The request conflicts with the current state.';
    case statusCode.tooManyRequests:
      return 'Too many requests. Please try again later.';
    case statusCode.serviceUnavailable:
      return 'The service is temporarily unavailable.';
    default:
      return 'An unexpected error occurred.';
  }
}
