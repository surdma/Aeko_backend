import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AuthenticationRepository,
  CreateCredentialAccountInput,
  CreateGoogleAccountInput,
} from '../../../modules/auth/authentication.repository.js';
import type {
  AuthenticationAccount,
  CreateAccountResult,
} from '../../../modules/auth/authentication.types.js';
import { PrismaService } from '../prisma.service.js';

const accountSelect = {
  id: true,
  name: true,
  username: true,
  email: true,
  password: true,
  avatar: true,
  profilePicture: true,
  bio: true,
  blueTick: true,
  goldenTick: true,
  banned: true,
  isAdmin: true,
  emailVerification: true,
  profileCompletion: true,
  twoFactorAuth: true,
  oauthProvider: true,
  oauthId: true,
  lastLoginAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

function jsonObject(value: Readonly<Record<string, unknown>>): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

function uniqueTarget(error: Prisma.PrismaClientKnownRequestError): string {
  const target = error.meta?.target;
  return Array.isArray(target) ? target.join(',') : String(target ?? '');
}

function mapUniqueFailure(error: unknown): CreateAccountResult | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return null;
  }
  const target = uniqueTarget(error).toLowerCase();
  if (target.includes('email')) return { kind: 'duplicate-email' };
  if (target.includes('username')) return { kind: 'duplicate-username' };
  return null;
}

@Injectable()
export class PrismaAuthenticationRepository implements AuthenticationRepository {
  public constructor(private readonly prisma: PrismaService) {}

  public findById(userId: string): Promise<AuthenticationAccount | null> {
    return this.prisma.user.findUnique({ where: { id: userId }, select: accountSelect });
  }

  public findByEmail(email: string): Promise<AuthenticationAccount | null> {
    return this.prisma.user.findUnique({ where: { email }, select: accountSelect });
  }

  public findByUsername(username: string): Promise<AuthenticationAccount | null> {
    return this.prisma.user.findUnique({ where: { username }, select: accountSelect });
  }

  public findByEmailOrUsername(
    email: string,
    username: string,
  ): Promise<AuthenticationAccount | null> {
    return this.prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
      select: accountSelect,
    });
  }

  public findByGoogleIdentity(oauthId: string): Promise<AuthenticationAccount | null> {
    return this.prisma.user.findFirst({
      where: { oauthProvider: 'google', oauthId },
      select: accountSelect,
    });
  }

  public async createCredentialAccount(
    input: CreateCredentialAccountInput,
  ): Promise<CreateAccountResult> {
    try {
      const account = await this.prisma.user.create({
        data: {
          name: input.name,
          username: input.username,
          email: input.email,
          password: input.passwordHash,
          emailVerification: {
            isVerified: false,
            verificationCode: input.verificationCode,
            codeExpiresAt: input.verificationExpiresAt,
            codeAttempts: 0,
            lastCodeSent: input.now,
          },
          profileCompletion: {
            hasProfilePicture: false,
            hasBio: false,
            hasFollowers: false,
            hasVerifiedEmail: false,
            completionPercentage: 0,
          },
        },
        select: accountSelect,
      });
      return { kind: 'created', account };
    } catch (error: unknown) {
      const mapped = mapUniqueFailure(error);
      if (mapped !== null) return mapped;
      throw error;
    }
  }

  public async createGoogleAccount(
    input: CreateGoogleAccountInput,
  ): Promise<CreateAccountResult> {
    try {
      const account = await this.prisma.user.create({
        data: {
          name: input.name,
          username: input.username,
          email: input.email,
          password: input.passwordHash,
          oauthProvider: 'google',
          oauthId: input.oauthId,
          avatar: input.avatar,
          emailVerification: { isVerified: true },
        },
        select: accountSelect,
      });
      return { kind: 'created', account };
    } catch (error: unknown) {
      const mapped = mapUniqueFailure(error);
      if (mapped !== null) return mapped;
      throw error;
    }
  }

  public updateVerificationState(
    userId: string,
    emailVerification: Readonly<Record<string, unknown>>,
    profileCompletion?: Readonly<Record<string, unknown>>,
  ): Promise<AuthenticationAccount> {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        emailVerification: jsonObject(emailVerification),
        ...(profileCompletion === undefined
          ? {}
          : { profileCompletion: jsonObject(profileCompletion) }),
      },
      select: accountSelect,
    });
  }

  public linkGoogleIdentity(
    userId: string,
    oauthId: string,
    avatar: string,
    emailVerification: Readonly<Record<string, unknown>>,
  ): Promise<AuthenticationAccount> {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        oauthProvider: 'google',
        oauthId,
        avatar,
        emailVerification: jsonObject(emailVerification),
      },
      select: accountSelect,
    });
  }

  public updateGoogleLogin(
    userId: string,
    lastLoginAt: Date,
    avatar?: string,
  ): Promise<AuthenticationAccount> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt, ...(avatar === undefined ? {} : { avatar }) },
      select: accountSelect,
    });
  }

  public async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: passwordHash },
      select: { id: true },
    });
  }
}
