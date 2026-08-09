import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

export interface RequestAuditContext {
  readonly ipAddress: string;
  readonly userAgent: string;
}

export const parseRequestAuditContext = (
  request: unknown,
): RequestAuditContext => {
  if (typeof request !== 'object' || request === null)
    return unknownAuditContext;
  const rawIp: unknown = Reflect.get(request, 'ip');
  const headers: unknown = Reflect.get(request, 'headers');
  const rawAgent: unknown =
    typeof headers === 'object' && headers !== null
      ? Reflect.get(headers, 'user-agent')
      : undefined;
  return Object.freeze({
    ipAddress: normalizeText(rawIp, 128),
    userAgent: normalizeText(rawAgent, 512),
  });
};

export const RequestAudit = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestAuditContext =>
    parseRequestAuditContext(context.switchToHttp().getRequest<unknown>()),
);

const normalizeText = (value: unknown, maximum: number): string => {
  if (typeof value !== 'string') return 'unknown';
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximum
    ? normalized
    : 'unknown';
};

const unknownAuditContext: RequestAuditContext = Object.freeze({
  ipAddress: 'unknown',
  userAgent: 'unknown',
});
