import { Injectable } from '@nestjs/common';
import { isPrismaCode, isPrismaUnavailable } from '../prisma-errors.js';
import { PrismaService } from '../prisma.service.js';
import type {
  CreateWaitlistEntryInput,
  CreateWaitlistEntryResult,
  FindWaitlistEntryResult,
  WaitlistRepository,
} from '../../../modules/waitlist/waitlist.repository.js';

@Injectable()
export class PrismaWaitlistRepository implements WaitlistRepository {
  public constructor(private readonly prisma: PrismaService) {}

  public async findByEmail(email: string): Promise<FindWaitlistEntryResult> {
    try {
      const entry = await this.prisma.waitlistEntry.findUnique({ where: { email } });
      return entry === null ? { kind: 'not-found' } : { kind: 'found', entry };
    } catch (error: unknown) {
      if (isPrismaUnavailable(error)) return { kind: 'database-unavailable' };
      throw error;
    }
  }

  public async create(input: CreateWaitlistEntryInput): Promise<CreateWaitlistEntryResult> {
    try {
      const entry = await this.prisma.waitlistEntry.create({ data: input });
      return { kind: 'created', entry };
    } catch (error: unknown) {
      if (isPrismaCode(error, 'P2002')) return { kind: 'duplicate' };
      if (isPrismaUnavailable(error)) return { kind: 'database-unavailable' };
      throw error;
    }
  }
}
