import { z } from 'zod';

import { DomainError } from '../errors/domain.error';

export interface PageQuery {
  readonly page: number;
  readonly limit: number;
}

export interface PageMeta extends PageQuery {
  readonly total: number;
  readonly pages: number;
}

const pageQuerySchema = z
  .object({
    page: z.coerce.number().int().default(1),
    limit: z.coerce.number().int().default(20),
  })
  .transform(({ page, limit }): PageQuery => ({
    page: Math.max(1, page),
    limit: Math.min(100, Math.max(1, limit)),
  }));

const validationDetails = (
  issues: readonly z.core.$ZodIssue[],
): Readonly<Record<string, readonly string[]>> => {
  const details: Record<string, readonly string[]> = {};

  for (const issue of issues) {
    const field = issue.path.length > 0 ? issue.path.join('.') : 'query';
    details[field] = [...(details[field] ?? []), issue.message];
  }

  return details;
};

export const parsePageQuery = (input: unknown): PageQuery => {
  const result = pageQuerySchema.safeParse(input);

  if (!result.success) {
    const details = validationDetails(result.error.issues);
    throw new DomainError(
      'VALIDATION_FAILED',
      `Invalid page query: ${Object.keys(details).join(', ')}`,
      details,
    );
  }

  return result.data;
};

export const createPageMeta = (query: PageQuery, total: number): PageMeta => {
  if (!Number.isInteger(total) || total < 0) {
    throw new DomainError('VALIDATION_FAILED', 'Invalid page metadata: total', {
      total: ['total must be a non-negative integer'],
    });
  }

  return {
    ...query,
    total,
    pages: Math.ceil(total / query.limit),
  };
};
