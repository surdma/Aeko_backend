import { Injectable, type LoggerService } from '@nestjs/common';

const REDACTED = '[REDACTED]';
const SENSITIVE_KEY_PATTERN =
  /authorization|cookie|password|secret|token|api[-_]?key|private[-_]?key|service[-_]?key|seed|mnemonic/iu;
const SENSITIVE_VALUE_PATTERNS: readonly RegExp[] = [
  /\bBearer\s+[^\s]+/giu,
  /\b(?:sk|pk|api)[-_][A-Za-z0-9_-]{12,}\b/gu,
  /\bpostgres(?:ql)?:\/\/[^\s@]+@/giu,
];

export type LogLevel = 'debug' | 'log' | 'warn' | 'error' | 'fatal';

function redactString(value: string): string {
  return SENSITIVE_VALUE_PATTERNS.reduce(
    (sanitized, pattern) => sanitized.replace(pattern, REDACTED),
    value,
  );
}

function sanitizeUnknown(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return redactString(value);
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (seen.has(value)) {
    return '[Circular]';
  }

  seen.add(value);

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: value.stack === undefined ? undefined : redactString(value.stack),
    };
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeUnknown(item, seen));
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : sanitizeUnknown(item, seen),
    ]),
  );
}

export function sanitizeLogValue(value: unknown): unknown {
  return sanitizeUnknown(value, new WeakSet<object>());
}

@Injectable()
export class SanitizedLogger implements LoggerService {
  public log(message: unknown, ...optionalParameters: readonly unknown[]): void {
    this.write('log', message, optionalParameters);
  }

  public error(message: unknown, ...optionalParameters: readonly unknown[]): void {
    this.write('error', message, optionalParameters);
  }

  public warn(message: unknown, ...optionalParameters: readonly unknown[]): void {
    this.write('warn', message, optionalParameters);
  }

  public debug(message: unknown, ...optionalParameters: readonly unknown[]): void {
    this.write('debug', message, optionalParameters);
  }

  public verbose(message: unknown, ...optionalParameters: readonly unknown[]): void {
    this.write('debug', message, optionalParameters);
  }

  public fatal(message: unknown, ...optionalParameters: readonly unknown[]): void {
    this.write('fatal', message, optionalParameters);
  }

  private write(
    level: LogLevel,
    message: unknown,
    optionalParameters: readonly unknown[],
  ): void {
    const record = {
      timestamp: new Date().toISOString(),
      level,
      message: sanitizeLogValue(message),
      ...(optionalParameters.length === 0
        ? {}
        : { context: sanitizeLogValue(optionalParameters) }),
    };
    const serialized = `${JSON.stringify(record)}\n`;

    if (level === 'error' || level === 'fatal') {
      process.stderr.write(serialized);
      return;
    }

    process.stdout.write(serialized);
  }
}
