import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { JoinWaitlistPipe } from '../../src/modules/waitlist/join-waitlist.pipe.js';

describe('JoinWaitlistPipe', () => {
  const pipe = new JoinWaitlistPipe();

  it('trims the name and lowercases the email', () => {
    expect(
      pipe.transform({
        name: '  Jane Doe  ',
        email: '  JANE@EXAMPLE.COM  ',
        ignored: true,
      }),
    ).toEqual({ name: 'Jane Doe', email: 'jane@example.com' });
  });

  it('preserves the missing-fields response', () => {
    try {
      pipe.transform({ name: 42, email: 'jane@example.com' });
      throw new Error('Expected validation to fail');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual({
        success: false,
        message: 'Name and email are required',
      });
    }
  });

  it('preserves the invalid-email response', () => {
    try {
      pipe.transform({ name: 'Jane', email: 'not-an-email' });
      throw new Error('Expected validation to fail');
    } catch (error: unknown) {
      expect((error as BadRequestException).getResponse()).toEqual({
        success: false,
        message: 'A valid email address is required',
      });
    }
  });
});
