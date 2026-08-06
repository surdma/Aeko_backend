import type { JwtService } from '@nestjs/jwt';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SanitizedLogger } from '../../src/common/sanitized-logger.js';
import type { AuthRepository } from '../../src/modules/auth/auth.repository.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';

const identity = {
  id: 'user-id',
  username: 'jane',
  email: 'jane@example.com',
  name: 'Jane Doe',
  isAdmin: false,
  banned: false,
  twoFactorAuth: { isEnabled: false },
} as const;

describe('AuthService', () => {
  const verifyAsync = vi.fn<(token: string) => Promise<unknown>>();
  let repository: AuthRepository;
  let service: AuthService;

  beforeEach(() => {
    verifyAsync.mockReset();
    repository = {
      findIdentityById: vi.fn(),
      findTwoFactorState: vi.fn(),
      updateTwoFactorState: vi.fn(),
      recordTwoFactorUse: vi.fn(),
    };
    const logger = new SanitizedLogger();
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    service = new AuthService(
      { verifyAsync } as unknown as JwtService,
      repository,
      logger,
    );
  });

  it('preserves the missing-token result', async () => {
    await expect(service.authenticate(undefined)).resolves.toEqual({
      kind: 'missing-token',
    });
  });

  it('supports both legacy id and userId claims', async () => {
    vi.mocked(repository.findIdentityById).mockResolvedValue(identity);
    verifyAsync.mockResolvedValue({ userId: identity.id });

    const result = await service.authenticate('Bearer valid-token');
    expect(result).toEqual({
      kind: 'authenticated',
      user: {
        id: identity.id,
        username: identity.username,
        email: identity.email,
        name: identity.name,
        isAdmin: false,
        banned: false,
        twoFactorEnabled: false,
        twoFactorStatus: { isEnabled: false },
      },
    });
  });

  it('rejects banned users and expired tokens', async () => {
    verifyAsync.mockResolvedValue({ id: identity.id });
    vi.mocked(repository.findIdentityById).mockResolvedValue({
      ...identity,
      banned: true,
    });
    await expect(service.authenticate('Bearer token')).resolves.toEqual({
      kind: 'account-suspended',
    });

    verifyAsync.mockRejectedValue(
      Object.assign(new Error('expired'), { name: 'TokenExpiredError' }),
    );
    await expect(service.authenticate('Bearer token')).resolves.toEqual({
      kind: 'expired-token',
    });
  });
});
