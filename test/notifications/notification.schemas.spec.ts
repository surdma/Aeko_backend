import { describe, expect, it } from 'vitest';
import { listNotificationsQuerySchema } from '../../src/modules/notifications/notification.schemas.js';

describe('notification query parsing', () => {
  it('applies the legacy page and limit defaults', () => {
    expect(listNotificationsQuerySchema.parse({})).toEqual({
      page: 1,
      limit: 20,
    });
  });

  it('uses JavaScript parseInt semantics', () => {
    expect(
      listNotificationsQuerySchema.parse({
        page: '02items',
        limit: '5.9',
        type: 'LIKE',
      }),
    ).toEqual({
      page: 2,
      limit: 5,
      type: 'LIKE',
    });
  });

  it('preserves invalid numeric values for the legacy 500 path', () => {
    const result = listNotificationsQuerySchema.parse({
      page: 'invalid',
      limit: '20',
    });

    expect(Number.isNaN(result.page)).toBe(true);
    expect(result.limit).toBe(20);
  });
});
