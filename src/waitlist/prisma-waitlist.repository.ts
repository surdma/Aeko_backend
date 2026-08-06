import { Injectable } from '@nestjs/common';
import type { WaitlistEntry } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateWaitlistEntryInput,
  WaitlistRepository,
} from './waitlist.repository.js';

@Injectable()
export class PrismaWaitlistRepository implements WaitlistRepository {
  public constructor(private readonly prisma: PrismaService) {}

  public findByEmail(email: string): Promise<WaitlistEntry | null> {
    return this.prisma.waitlistEntry.findUnique({ where: { email } });
  }

  public create(input: CreateWaitlistEntryInput): Promise<WaitlistEntry> {
    return this.prisma.waitlistEntry.create({ data: input });
  }
}
