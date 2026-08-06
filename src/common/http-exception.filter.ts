import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Injectable,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import type { RequestWithId } from './request-id.middleware.js';
import { SanitizedLogger } from './sanitized-logger.js';

interface PublicErrorBody {
  readonly code: string;
  readonly message: string;
  readonly details: unknown;
}

interface ErrorEnvelope {
  readonly success: false;
  readonly error: PublicErrorBody & {
    readonly requestId: string;
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
    return {
      code: 'HTTP_ERROR',
      message: exception.message,
      details: null,
    };
  }

  const messageValue = response.message;
  const message = Array.isArray(messageValue)
    ? messageValue.filter((item): item is string => typeof item === 'string').join(', ')
    : typeof messageValue === 'string'
      ? messageValue
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
  public constructor(private readonly logger: SanitizedLogger) {}

  public catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<RequestWithId>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const publicError = resolvePublicError(exception, status);
    const envelope: ErrorEnvelope = {
      success: false,
      error: {
        ...publicError,
        requestId: request.requestId,
      },
    };

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error('HTTP request failed', {
        requestId: request.requestId,
        method: request.method,
        path: request.originalUrl,
        status,
        exception,
      });
    }

    response.status(status).json(envelope);
  }
}
