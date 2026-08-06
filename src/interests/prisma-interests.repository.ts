import { Injectable } from '@nestjs/common';
import type { Interest } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { InterestsRepository } from './interests.repository.js';

@Injectable()
export class PrismaInterestsRepository implements InterestsRepository {
  public constructor(private readonly prisma: PrismaService) {}

  public listActive(): Promise<readonly Interest[]> {
    return this.prisma.interest.findMany({
      where: { isActive: true },
    });
  }
}
