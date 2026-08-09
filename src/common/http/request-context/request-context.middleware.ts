import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

interface RequestContextState {
  readonly requestId: string;
}

@Injectable()
export class RequestContext {
  private readonly storage = new AsyncLocalStorage<RequestContextState>();

  get requestId(): string | undefined {
    return this.storage.getStore()?.requestId;
  }

  run<Result>(requestId: string, callback: () => Result): Result {
    return this.storage.run({ requestId }, callback);
  }
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly context: RequestContext) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const candidate = request.headers['x-request-id'];
    const requestId =
      typeof candidate === 'string' && REQUEST_ID_PATTERN.test(candidate)
        ? candidate
        : randomUUID();
    request.headers['x-request-id'] = requestId;
    response.setHeader('x-request-id', requestId);
    this.context.run(requestId, next);
  }
}
