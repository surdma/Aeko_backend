import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Injectable,
  type ExceptionFilter,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { RequestWithId } from './request-id.middleware.js';
import { SanitizedLogger } from './sanitized-logger.js';

interface PublicErrorBody {
  readonly code: string;
  readonly message: string;
  readonly details: unknown;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLegacyEnvelope(value: unknown): value is Readonly<Record<string, unknown>> {
  return (
    isRecord(value) &&
    value.success === false &&
    (typeof value.message === 'string' || typeof value.error === 'string')
  );
}

function resolvePublicError(exception: unknown, status: number): PublicErrorBody {
  if (!(exception instanceof HttpException)) {
    return {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
      details: null,
    };
  }

  const response = exception.getResponse();
  if (typeof response === 'string') {
    return {
      code: status === HttpStatus.INTERNAL_SERVER_ERROR ? 'INTERNAL_SERVER_ERROR' : 'HTTP_ERROR',
      message: response,
      details: null,
    };
  }

  if (!isRecord(response)) {
    return { code: 'HTTP_ERROR', message: exception.message, details: null };
  }

  const value = response.message;
  const message = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').join(', ')
    : typeof value === 'string'
      ? value
      : exception.message;

  return {
    code: typeof response.code === 'string' ? response.code : 'HTTP_ERROR',
    message,
    details: response.details ?? null,
  };
}

@Catch()
@Injectable()
export class HttpExceptionFilter implements ExceptionFilter {
  public constructor(
    private readonly logger: SanitizedLogger,
    private readonly httpAdapterHost: HttpAdapterHost,
  ) {}

  public catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<unknown>();
    const request = context.getRequest<RequestWithId>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const requestId = request.requestId ?? 'unknown';
    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : undefined;

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error('HTTP request failed', {
        requestId,
        method: request.method,
        path: request.originalUrl,
        status,
        exception,
      });
    }

    if (isLegacyEnvelope(exceptionResponse)) {
      this.httpAdapterHost.httpAdapter.reply(response, exceptionResponse, status);
      return;
    }

    const publicError = resolvePublicError(exception, status);
    this.httpAdapterHost.httpAdapter.reply(
      response,
      {
        success: false,
        error: { ...publicError, requestId },
      },
      status,
    );
  }
}
