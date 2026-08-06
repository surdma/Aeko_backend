import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;

export interface RequestWithId extends Request {
  requestId: string;
}

function resolveRequestId(header: string | readonly string[] | undefined): string {
  const candidate = Array.isArray(header) ? header[0] : header;

  return typeof candidate === 'string' && REQUEST_ID_PATTERN.test(candidate)
    ? candidate
    : randomUUID();
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  public use(request: RequestWithId, response: Response, next: NextFunction): void {
    const requestId = resolveRequestId(request.headers['x-request-id']);

    request.requestId = requestId;
    response.setHeader('x-request-id', requestId);
    next();
  }
}
