import { z } from 'zod';

import type { JsonValue } from '../common/json/json-value';
import { boundedText, parseWithScope } from '../common/validation/parse';

/** A JSON value that a JSON column can hold without a null token. */
export type StoredJson = Exclude<JsonValue, null>;

export interface SubscriptionPlanCreate {
  readonly name: string;
  readonly price: number;
  readonly currency: string;
  readonly duration: string;
  readonly features: StoredJson;
  readonly limits?: StoredJson | undefined;
  readonly targetAudience: string | null;
}

export interface SubscriptionPlanUpdate {
  readonly name?: string | undefined;
  readonly price?: number | undefined;
  readonly currency?: string | undefined;
  readonly duration?: string | undefined;
  readonly features?: StoredJson | undefined;
  readonly limits?: StoredJson | undefined;
  readonly targetAudience?: string | null | undefined;
  readonly isActive?: boolean | undefined;
}

const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValue),
    z.record(z.string(), jsonValue),
  ]),
);

/**
 * A JSON column needs a provider-specific token to store a top-level null, so
 * the boundary accepts an object, array or scalar and rejects a bare null.
 * Nulls nested inside the value are stored normally. Legacy passed whatever it
 * was given straight to Prisma, which raised on this case anyway.
 */
const storedJson: z.ZodType<StoredJson> = jsonValue.refine(
  (value): value is StoredJson => value !== null,
  { message: 'must not be null' },
);

const price = z.number().finite().nonnegative();
const duration = z.enum(['monthly', 'yearly']);

/**
 * Defaults match the Prisma column defaults the legacy route relied on.
 * `features` is required because the column is not nullable: omitting it made
 * Prisma throw and the route answer 500.
 */
const planCreateSchema = z
  .object({
    name: boundedText(200),
    price,
    currency: boundedText(10).default('USD'),
    duration: duration.default('monthly'),
    features: storedJson,
    limits: storedJson.optional(),
    targetAudience: boundedText(200).nullable().default(null),
  })
  .strict();

/**
 * Legacy passed `req.body` straight into `prisma.update`, so an administrator
 * could rewrite `id`, `createdAt` or relation fields, and an unknown key made
 * the route answer 500. Only the columns the route documents are accepted, and
 * every one of them stays optional so a partial update keeps being partial.
 */
const planUpdateSchema = z
  .object({
    name: boundedText(200).optional(),
    price: price.optional(),
    currency: boundedText(10).optional(),
    duration: duration.optional(),
    features: storedJson.optional(),
    limits: storedJson.optional(),
    targetAudience: boundedText(200).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const parseSubscriptionPlanCreate = (
  input: unknown,
): SubscriptionPlanCreate =>
  Object.freeze(parseWithScope(planCreateSchema, input, 'subscription plan'));

export const parseSubscriptionPlanUpdate = (
  input: unknown,
): SubscriptionPlanUpdate =>
  Object.freeze(parseWithScope(planUpdateSchema, input, 'subscription plan'));
