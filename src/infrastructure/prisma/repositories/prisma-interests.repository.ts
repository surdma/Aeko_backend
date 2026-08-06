import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  CreateInterestInput,
  CreateInterestPersistenceResult,
  InterestRecord,
  InterestsRepository,
  UpdateInterestInput,
  UserInterestState,
} from '../../../modules/interests/interests.repository.js';
import { isPrismaCode } from '../prisma-errors.js';
import { PrismaService } from '../prisma.service.js';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringIds(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

@Injectable()
export class PrismaInterestsRepository implements InterestsRepository {
  public constructor(private readonly prisma: PrismaService) {}

  public listActive(): Promise<readonly InterestRecord[]> {
    return this.prisma.interest.findMany({ where: { isActive: true } });
  }

  public listActiveByIds(ids: readonly string[]): Promise<readonly InterestRecord[]> {
    return this.prisma.interest.findMany({ where: { id: { in: [...ids] }, isActive: true } });
  }

  public findById(id: string): Promise<InterestRecord | null> {
    return this.prisma.interest.findUnique({ where: { id } });
  }

  public async create(input: CreateInterestInput): Promise<CreateInterestPersistenceResult> {
    try {
      const interest = await this.prisma.interest.create({
        data: { ...input, isActive: true },
      });
      return { kind: 'created', interest };
    } catch (error: unknown) {
      if (isPrismaCode(error, 'P2002')) return { kind: 'duplicate' };
      throw error;
    }
  }

  public update(id: string, input: UpdateInterestInput): Promise<InterestRecord> {
    return this.prisma.interest.update({ where: { id }, data: input });
  }

  public async delete(id: string): Promise<boolean> {
    try {
      await this.prisma.interest.delete({ where: { id } });
      return true;
    } catch (error: unknown) {
      if (isPrismaCode(error, 'P2025')) return false;
      throw error;
    }
  }

  public async findUserState(userId: string): Promise<UserInterestState | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { interests: true, profileCompletion: true },
    });
    if (user === null) return null;
    return {
      interestIds: stringIds(user.interests),
      profileCompletion: isRecord(user.profileCompletion) ? user.profileCompletion : {},
    };
  }

  public async updateUserInterestIds(
    userId: string,
    interestIds: readonly string[],
    profileCompletion?: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        interests: jsonInput([...interestIds]),
        ...(profileCompletion === undefined
          ? {}
          : { profileCompletion: jsonInput(profileCompletion) }),
      },
    });
  }
}
