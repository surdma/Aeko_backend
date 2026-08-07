import { JwtService } from '@nestjs/jwt';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SanitizedLogger } from '../../src/common/sanitized-logger.js';
import type { AppConfiguration } from '../../src/config/configuration.js';
import type { TotpVerificationService } from '../../src/infrastructure/auth/totp-verification.service.js';
import type { AuthEmailDelivery } from '../../src/modules/auth/auth-email-delivery.port.js';
import type {
  AuthRepository,
  SecurityRequestContext,
} from '../../src/modules/auth/auth.repository.js';
import type { AuthenticationRepository } from '../../src/modules/auth/authentication.repository.js';
import type { AuthenticationAccount } from '../../src/modules/auth/authentication.types.js';
import { GoogleAuthenticationService } from '../../src/modules/auth/google-authentication.service.js';
import type { GoogleIdentityProvider } from '../../src/modules/auth/google-identity-provider.port.js';
import type { PasswordHasher } from '../../src/modules/auth/password-hasher.port.js';
import { PasswordRecoveryService } from '../../src/modules/auth/password-recovery.service.js';
import { RegistrationService } from '../../src/modules/auth/registration.service.js';
import { SessionAuthenticationService } from '../../src/modules/auth/session-authentication.service.js';

const account: AuthenticationAccount = {
  id: 'user-1',
  name: 'Ada User',
  username: 'ada',
  email: 'ada@example.com',
  password: 'hashed-password',
  avatar: null,
  profilePicture: null,
  bio: null,
  blueTick: false,
  goldenTick: false,
  banned: false,
  isAdmin: false,
  emailVerification: {
    isVerified: false,
    verificationCode: '1234',
    codeExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    codeAttempts: 0,
    lastCodeSent: new Date(0).toISOString(),
  },
  profileCompletion: {},
  twoFactorAuth: {},
  oauthProvider: null,
  oauthId: null,
  lastLoginAt: null,
  createdAt: new Date('2026-08-06T00:00:00.000Z'),
};

const configuration: AppConfiguration = {
  app: { environment: 'test', host: '0.0.0.0', port: 9876 },
  database: { url: 'postgresql://aeko:aeko@localhost:5432/aeko_test' },
  http: {
    bodyLimit: '10mb',
    corsOrigins: ['http://localhost:3000'],
    trustProxy: 1,
  },
  logging: { level: 'error' },
  authentication: { mode: 'better-auth' },
  auth: {
    jwtSecret: 'test-jwt-secret-with-at-least-32-characters',
    twoFactorSecretKey: 'test-two-factor-secret-key-32chars',
    frontendUrl: 'http://localhost:3000',
    google: {
      clientId: null,
      clientSecret: null,
      callbackUrl: null,
      failureRedirect: 'aeko://auth/failed',
    },
  },
  betterAuth: {
    secret: 'test-better-auth-secret-with-at-least-32-characters',
    url: 'http://127.0.0.1:9876',
    trustedOrigins: ['http://localhost:3000'],
    google: { configured: false, clientId: null, clientSecret: null },
    passkey: {
      rpId: 'localhost',
      rpName: 'Aeko',
      origin: 'http://localhost:9876',
    },
    expoScheme: 'aeko',
    resend: { configured: false, apiKey: null, from: null },
  },
  email: {
    zeptoMailApiUrl: null,
    zeptoMailApiKey: null,
    senderName: 'Aeko',
  },
};

const requestContext: SecurityRequestContext = {
  ipAddress: '127.0.0.1',
  userAgent: 'Vitest',
};

function createRepository(): AuthenticationRepository {
  return {
    findById: vi.fn(),
    findByEmail: vi.fn(),
    findByUsername: vi.fn(),
    findByEmailOrUsername: vi.fn(),
    findByGoogleIdentity: vi.fn(),
    createCredentialAccount: vi.fn(),
    createGoogleAccount: vi.fn(),
    updateVerificationState: vi.fn(),
    linkGoogleIdentity: vi.fn(),
    updateGoogleLogin: vi.fn(),
    updatePassword: vi.fn(),
  };
}

function createAccessRepository(): AuthRepository {
  return {
    findIdentityById: vi.fn(),
    findTwoFactorState: vi.fn(),
    updateTwoFactorState: vi.fn(),
    recordTwoFactorUse: vi.fn(),
  };
}

describe('authentication use cases', () => {
  let repository: AuthenticationRepository;
  let accessRepository: AuthRepository;
  let passwordHasher: PasswordHasher;
  let emailDelivery: AuthEmailDelivery;
  let totpVerification: TotpVerificationService;
  let logger: SanitizedLogger;
  let registration: RegistrationService;
  let sessions: SessionAuthenticationService;

  beforeEach(() => {
    repository = createRepository();
    accessRepository = createAccessRepository();
    passwordHasher = {
      hash: vi.fn(async () => 'new-hash'),
      compare: vi.fn(
        async (value, hash) =>
          value === 'password' && hash === 'hashed-password',
      ),
    };
    emailDelivery = {
      sendVerificationCode: vi.fn(async () => true),
      sendWelcomeEmail: vi.fn(async () => undefined),
      sendLoginNotification: vi.fn(async () => undefined),
      sendPasswordResetEmail: vi.fn(async () => undefined),
    };
    totpVerification = {
      verifyForOperation: vi.fn(async () => 'verified'),
    } as unknown as TotpVerificationService;
    logger = {
      error: vi.fn(),
      warn: vi.fn(),
    } as unknown as SanitizedLogger;
    const jwt = new JwtService({ secret: configuration.auth.jwtSecret });
    registration = new RegistrationService(
      repository,
      passwordHasher,
      emailDelivery,
      jwt,
      logger,
    );
    sessions = new SessionAuthenticationService(
      repository,
      accessRepository,
      passwordHasher,
      emailDelivery,
      jwt,
      totpVerification,
      logger,
    );
  });

  it('creates a credential account with the legacy verification and profile values', async () => {
    vi.mocked(repository.findByEmailOrUsername).mockResolvedValue(null);
    vi.mocked(repository.createCredentialAccount).mockResolvedValue({
      kind: 'created',
      account,
    });

    const result = await registration.signup({
      name: account.name,
      username: account.username,
      email: account.email,
      password: 'password',
    });

    expect(result).toEqual({
      kind: 'created',
      userId: account.id,
      emailSent: true,
      verificationCode: expect.stringMatching(/^\d{4}$/u),
    });
    expect(repository.createCredentialAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        name: account.name,
        username: account.username,
        email: account.email,
        passwordHash: 'new-hash',
      }),
    );
    expect(emailDelivery.sendVerificationCode).toHaveBeenCalledOnce();
  });

  it('reports the verification-code fallback when email delivery fails', async () => {
    vi.mocked(repository.findByEmailOrUsername).mockResolvedValue(null);
    vi.mocked(repository.createCredentialAccount).mockResolvedValue({
      kind: 'created',
      account,
    });
    vi.mocked(emailDelivery.sendVerificationCode).mockResolvedValue(false);

    const result = await registration.signup({
      name: account.name,
      username: account.username,
      email: account.email,
      password: 'password',
    });

    expect(result).toEqual({
      kind: 'created',
      userId: account.id,
      emailSent: false,
      verificationCode: expect.stringMatching(/^\d{4}$/u),
    });
  });

  it('increments verification attempts without exposing repository failures', async () => {
    vi.mocked(repository.findById).mockResolvedValue(account);
    vi.mocked(repository.updateVerificationState).mockResolvedValue(account);

    const result = await registration.verifyEmail({
      userId: account.id,
      verificationCode: '9999',
    });

    expect(result).toEqual({ kind: 'invalid-code' });
    expect(repository.updateVerificationState).toHaveBeenCalledWith(
      account.id,
      expect.objectContaining({ codeAttempts: 1 }),
    );
  });

  it('requires a second factor after valid credentials when 2FA is enabled', async () => {
    vi.mocked(repository.findByEmail).mockResolvedValue({
      ...account,
      emailVerification: { isVerified: true },
      twoFactorAuth: { isEnabled: true, backupCodes: [] },
    });

    const result = await sessions.login(
      { email: account.email, password: 'password' },
      requestContext,
    );

    expect(result).toEqual({
      kind: 'two-factor-required',
      userId: account.id,
    });
  });

  it('consumes one matching backup code and returns the normal login view', async () => {
    vi.mocked(repository.findByEmail).mockResolvedValue({
      ...account,
      emailVerification: { isVerified: true },
      twoFactorAuth: {
        isEnabled: true,
        backupCodes: [{ code: 'backup-hash', used: false, usedAt: null }],
      },
    });
    vi.mocked(passwordHasher.compare).mockImplementation(
      async (value, hash) =>
        (value === 'password' && hash === 'hashed-password') ||
        (value === 'BACKUP01' && hash === 'backup-hash'),
    );

    const result = await sessions.login(
      {
        email: account.email,
        password: 'password',
        backupCode: 'BACKUP01',
      },
      requestContext,
    );

    expect(result.kind).toBe('authenticated');
    expect(accessRepository.updateTwoFactorState).toHaveBeenCalledWith(
      account.id,
      expect.objectContaining({
        backupCodes: [expect.objectContaining({ used: true })],
      }),
    );
  });

  it('preserves sparse profile completion fields for older accounts', async () => {
    vi.mocked(repository.findById).mockResolvedValue(account);

    const result = await sessions.profileCompletion(account.id);

    expect(result).toEqual({
      kind: 'found',
      profileCompletion: {
        blueTick: false,
        nextSteps: [
          'Add a profile picture',
          'Write a bio (minimum 10 characters)',
          'Get your first follower',
          'Verify your email address',
        ],
        requirements: {},
      },
    });
  });

  it('uses only the verified Google identity email for mobile authentication', async () => {
    const verifiedAccount: AuthenticationAccount = {
      ...account,
      name: 'Untrusted Name',
      email: 'verified@example.com',
      emailVerification: { isVerified: true },
      oauthProvider: 'google',
      oauthId: 'google-subject',
    };
    const identityProvider: GoogleIdentityProvider = {
      isConfigured: vi.fn(() => true),
      createAuthorizationUrl: vi.fn(
        () => 'https://accounts.google.com/auth',
      ),
      exchangeAuthorizationCode: vi.fn(async () => ({
        providerId: 'google-subject',
        email: 'verified@example.com',
        name: 'Verified User',
        photo: null,
      })),
      verifyIdToken: vi.fn(async () => ({
        providerId: 'google-subject',
        email: 'verified@example.com',
        name: 'Verified User',
        photo: null,
      })),
    };
    vi.mocked(repository.findByGoogleIdentity).mockResolvedValue(null);
    vi.mocked(repository.findByEmail).mockResolvedValue(null);
    vi.mocked(repository.findByUsername).mockResolvedValue(null);
    vi.mocked(repository.createGoogleAccount).mockResolvedValue({
      kind: 'created',
      account: verifiedAccount,
    });
    vi.mocked(repository.updateGoogleLogin).mockResolvedValue(verifiedAccount);
    const google = new GoogleAuthenticationService(
      repository,
      identityProvider,
      passwordHasher,
      new JwtService({ secret: configuration.auth.jwtSecret }),
      logger,
    );

    const result = await google.mobile({
      idToken: 'verified-token',
      user: {
        email: 'untrusted@example.com',
        name: 'Untrusted Name',
      },
    });

    expect(result.kind).toBe('authenticated');
    expect(repository.createGoogleAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'verified@example.com',
        name: 'Untrusted Name',
      }),
    );
  });

  it('keeps forgot-password responses identical for unknown accounts', async () => {
    vi.mocked(repository.findByEmail).mockResolvedValue(null);
    const recovery = new PasswordRecoveryService(
      repository,
      emailDelivery,
      passwordHasher,
      new JwtService({ secret: configuration.auth.jwtSecret }),
      configuration,
      logger,
    );

    await expect(
      recovery.forgotPassword({ email: 'unknown@example.com' }),
    ).resolves.toEqual({ kind: 'accepted' });
    expect(emailDelivery.sendPasswordResetEmail).not.toHaveBeenCalled();
  });
});
