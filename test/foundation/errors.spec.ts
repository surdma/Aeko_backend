import { HttpStatus } from '@nestjs/common';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import {
  DomainError,
  type PublicErrorBody,
} from '../../src/common/errors/domain.error';
import { GlobalExceptionFilter } from '../../src/common/errors/global-exception/global-exception.filter';

class RecordingResponse {
  statusCode = 0;
  body: PublicErrorBody | undefined;

  status(statusCode: number): this {
    this.statusCode = statusCode;
    return this;
  }

  json(body: PublicErrorBody): this {
    this.body = body;
    return this;
  }
}

class RecordingLogger {
  readonly entries: readonly unknown[] = [];
  private mutableEntries: unknown[] = [];

  error(entry: unknown): void {
    this.mutableEntries.push(entry);
    Object.defineProperty(this, 'entries', { value: [...this.mutableEntries] });
  }
}

function capture(exception: unknown): {
  readonly status: number;
  readonly body: PublicErrorBody;
  readonly logs: readonly unknown[];
} {
  const response = new RecordingResponse();
  const logger = new RecordingLogger();
  const request = {
    method: 'GET',
    originalUrl: '/private',
    requestId: 'request-123',
  };
  const host = new ExecutionContextHost([request, response]);
  host.setType('http');

  new GlobalExceptionFilter(logger, { requestId: 'request-123' }).catch(
    exception,
    host,
  );
  if (!response.body) {
    throw new Error('The exception filter did not emit a response body.');
  }
  return {
    status: response.statusCode,
    body: response.body,
    logs: logger.entries,
  };
}

describe('GlobalExceptionFilter', () => {
  it('maps a DomainError to its typed public contract', () => {
    const result = capture(
      new DomainError('NOT_FOUND', 'The requested resource was not found.', {
        field: ['missing'],
      }),
    );

    expect(result.status).toBe(HttpStatus.NOT_FOUND);
    expect(result.body).toEqual({
      success: false,
      code: 'NOT_FOUND',
      message: 'The requested resource was not found.',
      requestId: 'request-123',
      details: { field: ['missing'] },
    });
  });

  it('sanitizes unknown exceptions in the response and structured log', () => {
    const secret = 'postgresql://admin:raw-secret@db.internal/aeko';
    const result = capture(new Error(secret));

    expect(result.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(result.body).toEqual({
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      requestId: 'request-123',
    });
    expect(JSON.stringify(result.body)).not.toContain(secret);
    expect(JSON.stringify(result.logs)).not.toContain(secret);
    expect(result.logs).toEqual([
      {
        event: 'request_failed',
        requestId: 'request-123',
        method: 'GET',
        path: '/private',
        status: 500,
        code: 'INTERNAL_ERROR',
        errorType: 'Error',
      },
    ]);
  });

  it('maps Prisma availability failures without exposing raw metadata', () => {
    const exception = Object.assign(new Error('password=raw-secret'), {
      name: 'PrismaClientInitializationError',
      errorCode: 'P1001',
    });

    const result = capture(exception);

    expect(result.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(result.body.code).toBe('DATABASE_UNAVAILABLE');
    expect(JSON.stringify(result)).not.toContain('raw-secret');
  });
});
