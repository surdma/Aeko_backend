import { z } from 'zod';

import { DomainError } from '../errors/domain.error';

/**
 * Names the offending fields in every validation failure. Zod reports an
 * unrecognized key with an empty path, so those keys are read from the issue
 * itself; otherwise a rejected mutation reads as a generic error.
 */
const issueFields = (issue: z.core.$ZodIssue): readonly string[] => {
  if (issue.code === 'unrecognized_keys') return issue.keys;
  return [issue.path.length > 0 ? issue.path.join('.') : ''];
};

export function validationFailure(scope: string, error: z.ZodError): never {
  const fields = error.issues.flatMap((issue) =>
    issueFields(issue).map((field) => (field === '' ? scope : field)),
  );
  throw new DomainError(
    'VALIDATION_FAILED',
    `Invalid ${scope}: ${fields.join(', ')}`,
    { [scope]: error.issues.map((issue) => issue.message) },
  );
}

export const parseWithScope = <T>(
  schema: z.ZodType<T>,
  input: unknown,
  scope: string,
): T => {
  const result = schema.safeParse(input);
  return result.success ? result.data : validationFailure(scope, result.error);
};

export const boundedText = (maximum: number) =>
  z.string().trim().min(1).max(maximum);

export const queryInteger = (fallback: number, maximum: number) =>
  z.coerce
    .number()
    .int()
    .catch(fallback)
    .transform((value) => Math.min(maximum, Math.max(1, value)));
