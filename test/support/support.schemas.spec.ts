import { describe, expect, it } from 'vitest';
import {
  createSupportTicketSchema,
  listAdminSupportTicketsQuerySchema,
} from '../../src/modules/support/support.schemas.js';

describe('support request schemas', () => {
  it('applies legacy defaults while ignoring unrelated Express body fields', () => {
    const parsed = createSupportTicketSchema.parse({
      subject: 'Account help',
      description: 'I need help',
      category: 'account',
      priority: '',
      unrelated: 'ignored by the application service',
    });

    expect(parsed.priority).toBe('medium');
    expect(parsed.unrelated).toBe('ignored by the application service');
  });

  it('normalizes administrator pagination with parseInt-compatible values', () => {
    const parsed = listAdminSupportTicketsQuerySchema.parse({
      status: '',
      page: '2items',
      limit: '10',
    });

    expect(parsed).toMatchObject({ page: 2, limit: 10 });
    expect(parsed.status).toBeUndefined();
  });

  it('rejects malformed pagination before it reaches Prisma', () => {
    expect(() =>
      listAdminSupportTicketsQuerySchema.parse({ page: 'invalid', limit: '20' }),
    ).toThrow();
  });
});
