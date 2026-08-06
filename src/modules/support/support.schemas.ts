import { z } from 'zod';

const requiredText = z.string().min(1);

const optionalQueryText = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);

const positiveInteger = (defaultValue: number) =>
  z.preprocess(
    (value) => {
      if (value === undefined || value === '') return defaultValue;
      if (typeof value === 'string') return Number.parseInt(value, 10);
      return value;
    },
    z.number().int().positive(),
  );

export const createSupportTicketSchema = z
  .object({
    subject: requiredText,
    description: requiredText,
    category: requiredText,
    priority: z.preprocess(
      (value) => (value === '' ? undefined : value),
      requiredText.default('medium'),
    ),
  })
  .passthrough();

export const addSupportMessageSchema = z
  .object({
    message: requiredText,
    attachments: z.array(z.string()).default([]),
  })
  .passthrough();

export const updateSupportTicketStatusSchema = z
  .object({
    status: requiredText,
  })
  .passthrough();

export const updateSupportTicketPrioritySchema = z
  .object({
    priority: requiredText,
  })
  .passthrough();

export const listAdminSupportTicketsQuerySchema = z
  .object({
    status: optionalQueryText,
    category: optionalQueryText,
    priority: optionalQueryText,
    page: positiveInteger(1),
    limit: positiveInteger(20),
  })
  .passthrough();

export type CreateSupportTicketBody = z.infer<
  typeof createSupportTicketSchema
>;
export type AddSupportMessageBody = z.infer<typeof addSupportMessageSchema>;
export type UpdateSupportTicketStatusBody = z.infer<
  typeof updateSupportTicketStatusSchema
>;
export type UpdateSupportTicketPriorityBody = z.infer<
  typeof updateSupportTicketPrioritySchema
>;
export type ListAdminSupportTicketsQuery = z.infer<
  typeof listAdminSupportTicketsQuerySchema
>;
