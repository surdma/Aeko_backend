import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import { z } from 'zod';

const rawJoinWaitlistSchema = z
  .object({ name: z.unknown().optional(), email: z.unknown().optional() })
  .passthrough();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export interface JoinWaitlistInput {
  readonly name: string;
  readonly email: string;
}

function legacyBadRequest(message: string): BadRequestException {
  return new BadRequestException({ success: false, message });
}

@Injectable()
export class JoinWaitlistPipe implements PipeTransform<unknown, JoinWaitlistInput> {
  public transform(value: unknown): JoinWaitlistInput {
    const source = typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
    const parsed = rawJoinWaitlistSchema.parse(source);
    const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
    const email = typeof parsed.email === 'string' ? parsed.email.trim().toLowerCase() : '';
    if (!name || !email) throw legacyBadRequest('Name and email are required');
    if (!EMAIL_PATTERN.test(email)) throw legacyBadRequest('A valid email address is required');
    return { name, email };
  }
}
