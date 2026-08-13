import type { IncomingHttpHeaders } from 'node:http';
import {
  ConfigurationService,
  type AppConfig,
} from '../../src/configuration/configuration/configuration.service';
import {
  RealtimeAuthenticationError,
  RealtimeAuthService,
} from '../../src/realtime/realtime-auth.service';
import { RealtimeHealthService } from '../../src/realtime/realtime-health.service';
import { RealtimeRateLimiterService } from '../../src/realtime/realtime-rate-limiter.service';
import { RealtimeRoomNames } from '../../src/realtime/realtime-room-names';

const USER_ID = 'a7f739c9-2cb0-44f5-9bc5-1908db2abb09';
const CHAT_ID = '0e4678a6-c161-4418-889c-b22a1262a8b0';

function configuration(): ConfigurationService {
  const value: AppConfig = {
    nodeEnv: 'test',
    port: 3000,
    databaseUrl: 'postgresql://test:test@localhost:5432/aeko',
    betterAuthSecret: 'a'.repeat(32),
    betterAuthUrl: 'http://localhost:3000',
    trustedOrigins: ['https://app.aeko.test'],
    proxyHops: 0,
    redisUrl: null,
    providerCredentials: {},
  };
  return new ConfigurationService(value);
}

describe('realtime infrastructure', () => {
  it('authenticates a trusted socket handshake through Better Auth', async () => {
    const auth = new RealtimeAuthService(configuration(), {
      resolvePrincipal: jest.fn().mockResolvedValue({
        userId: USER_ID,
        sessionId: 'session-id',
        email: 'member@aeko.test',
        username: 'member',
        isAdmin: false,
        banned: false,
        twoFactorEnabled: false,
        twoFactorSatisfied: true,
      }),
    });

    await expect(
      auth.authenticate({
        headers: { origin: 'https://app.aeko.test' },
      }),
    ).resolves.toMatchObject({ userId: USER_ID });
  });

  it('rejects a handshake without a trusted authenticated session', async () => {
    const auth = new RealtimeAuthService(configuration(), {
      resolvePrincipal: jest.fn().mockResolvedValue(undefined),
    });

    await expect(
      auth.authenticate({ headers: { origin: 'https://app.aeko.test' } }),
    ).rejects.toMatchObject<Partial<RealtimeAuthenticationError>>({
      code: 'AUTHENTICATION_REQUIRED',
    });
  });

  it('uses namespaced room names', () => {
    const rooms = new RealtimeRoomNames();
    expect(rooms.chat(CHAT_ID)).toBe(`aeko:chat:${CHAT_ID}`);
  });

  it('drops exhausted ephemeral events without denying durable sends', async () => {
    const limiter = new RealtimeRateLimiterService(configuration());
    await expect(
      limiter.consume({ principalId: USER_ID, event: 'send_message' }),
    ).resolves.toBe('allow');

    let result: string = 'allow';
    for (let index = 0; index < 11; index += 1) {
      result = await limiter.consume({
        principalId: USER_ID,
        event: 'typing_start',
      });
    }
    expect(result).toBe('drop-ephemeral');
  });

  it('reports degraded mode until the Redis adapter is active', () => {
    const health = new RealtimeHealthService();
    expect(health.snapshot().adapter).toBe('degraded');
  });
});

export function handshake(headers: IncomingHttpHeaders): {
  readonly headers: IncomingHttpHeaders;
} {
  return { headers };
}
