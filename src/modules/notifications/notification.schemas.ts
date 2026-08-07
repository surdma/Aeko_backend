import { z } from 'zod';

function parseLegacyInteger(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  return Number.parseInt(String(value), 10);
}

export const listNotificationsQuerySchema = z
  .object({
    page: z
      .unknown()
      .optional()
      .transform((value: unknown) => parseLegacyInteger(value, 1)),
    limit: z
      .unknown()
      .optional()
      .transform((value: unknown) => parseLegacyInteger(value, 20)),
    type: z.unknown().optional(),
  })
  .passthrough();

export type ListNotificationsQuery = z.infer<
  typeof listNotificationsQuerySchema
>;
