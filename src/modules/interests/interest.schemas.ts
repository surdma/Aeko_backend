import { z } from 'zod';

export const createInterestSchema = z
  .object({
    name: z.string().min(1),
    displayName: z.string().min(1),
    description: z.string().optional().default(''),
    icon: z.string().optional().default(''),
  })
  .passthrough();

export const updateInterestSchema = z
  .object({
    displayName: z.string().optional(),
    description: z.string().optional(),
    icon: z.string().optional(),
    isActive: z.boolean().optional(),
  })
  .passthrough();

export const userInterestIdsSchema = z
  .object({ interestIds: z.array(z.string()) })
  .passthrough();

export type CreateInterestBody = z.infer<typeof createInterestSchema>;
export type UpdateInterestBody = z.infer<typeof updateInterestSchema>;
export type UserInterestIdsBody = z.infer<typeof userInterestIdsSchema>;
