import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthRepository, TwoFactorAuditInput } from '../../../modules/auth/auth.repository.js';
import type { IdentityRecord } from '../../../modules/auth/auth.types.js';
import { PrismaService } from '../prisma.service.js';

function jsonInput(value: Readonly<Record<string, unknown>>): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

@Injectable()
export class PrismaAuthRepository implements AuthRepository {
  public constructor(private readonly prisma: PrismaService) {}

  public findIdentityById(userId: string): Promise<IdentityRecord | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        name: true,
        isAdmin: true,
        banned: true,
        twoFactorAuth: true,
      },
    });
  }

  public async findTwoFactorState(userId: string): Promise<unknown> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorAuth: true },
    });
    return user?.twoFactorAuth ?? null;
  }

  public async updateTwoFactorState(
    userId: string,
    state: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorAuth: jsonInput(state) },
    });
  }

  public async recordTwoFactorUse(input: TwoFactorAuditInput): Promise<void> {
    await this.prisma.securityEvent.create({
      data: {
        userId: input.userId,
        eventType: '2fa_used',
        targetUserId: null,
        metadata: { method: 'totp', loginAttempt: false },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        success: input.success,
        errorMessage: input.errorMessage ?? null,
        timestamp: new Date(),
      },
    });
  }
}
