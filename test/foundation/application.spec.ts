import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApplication, type ApplicationOptions } from '../../src/main';
import { RequestContext } from '../../src/common/http/request-context/request-context.middleware';
import { loadAppConfig } from '../../src/configuration/configuration/configuration.service';
import type { PrismaLifecycleClient } from '../../src/database/prisma/prisma.service';

const validEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://aeko:test@localhost:5432/aeko_test',
  BETTER_AUTH_SECRET: 'test-secret-with-at-least-thirty-two-characters',
  BETTER_AUTH_URL: 'http://localhost:3000',
  BETTER_AUTH_TRUSTED_ORIGINS:
    'http://localhost:3001,chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,aeko://',
  TRUST_PROXY: '1',
  BETTER_AUTH_GOOGLE_CLIENT_ID: 'google-client-id',
  BETTER_AUTH_GOOGLE_CLIENT_SECRET: 'google-client-secret',
};

class FakePrismaClient implements PrismaLifecycleClient {
  connectStarted = false;
  disconnectStarted = false;
  readinessError: Error | undefined;
  private releaseConnectCallback: (() => void) | undefined;
  private releaseDisconnectCallback: (() => void) | undefined;
  private readonly connectPromise = new Promise<void>((resolve) => {
    this.releaseConnectCallback = resolve;
  });
  private readonly disconnectPromise = new Promise<void>((resolve) => {
    this.releaseDisconnectCallback = resolve;
  });

  async $connect(): Promise<void> {
    this.connectStarted = true;
    await this.connectPromise;
  }

  async $disconnect(): Promise<void> {
    this.disconnectStarted = true;
    await this.disconnectPromise;
  }

  async $queryRaw(_query: TemplateStringsArray): Promise<unknown> {
    if (this.readinessError) {
      throw this.readinessError;
    }
    return [{ ready: 1 }];
  }

  releaseConnect(): void {
    if (!this.releaseConnectCallback) {
      throw new Error('Connect callback was not initialized.');
    }
    this.releaseConnectCallback();
  }

  releaseDisconnect(): void {
    if (!this.releaseDisconnectCallback) {
      throw new Error('Disconnect callback was not initialized.');
    }
    this.releaseDisconnectCallback();
  }
}

function applicationOptions(
  databaseClient: PrismaLifecycleClient,
): ApplicationOptions {
  return {
    environment: validEnvironment,
    databaseClient,
    logger: false,
  };
}

describe('strict application foundation', () => {
  it('rejects invalid environment values before application startup', () => {
    expect(() =>
      loadAppConfig({
        ...validEnvironment,
        DATABASE_URL: 'not-a-database-url',
      }),
    ).toThrow('Invalid application configuration');
  });

  it('exports only normalized immutable configuration', () => {
    const configuration = loadAppConfig(validEnvironment);

    expect(configuration.trustedOrigins).toEqual([
      'http://localhost:3001',
      'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'aeko://',
    ]);
    expect(configuration.proxyHops).toBe(1);
    expect(configuration.providerCredentials).toEqual({
      googleClientId: 'google-client-id',
      googleClientSecret: 'google-client-secret',
    });
    expect(Object.isFrozen(configuration)).toBe(true);
    expect(Object.isFrozen(configuration.trustedOrigins)).toBe(true);
  });

  it('makes request context available during the active async request chain', () => {
    const context = new RequestContext();
    let observed: string | undefined;

    context.run('request-in-context', () => {
      observed = context.requestId;
    });

    expect(observed).toBe('request-in-context');
    expect(context.requestId).toBeUndefined();
  });

  it('awaits Prisma connection during creation and disconnection during close', async () => {
    const client = new FakePrismaClient();
    let applicationResolved = false;
    const applicationPromise = createApplication(
      applicationOptions(client),
    ).then((application) => {
      applicationResolved = true;
      return application;
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(client.connectStarted).toBe(true);
    expect(applicationResolved).toBe(false);

    client.releaseConnect();
    const application = await applicationPromise;
    let closeResolved = false;
    const closePromise = application.close().then(() => {
      closeResolved = true;
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(client.disconnectStarted).toBe(true);
    expect(closeResolved).toBe(false);

    client.releaseDisconnect();
    await closePromise;
    expect(closeResolved).toBe(true);
  });

  describe('HTTP probes and request context', () => {
    let application: INestApplication;
    let client: FakePrismaClient;

    beforeEach(async () => {
      client = new FakePrismaClient();
      client.releaseConnect();
      application = await createApplication(applicationOptions(client));
    });

    afterEach(async () => {
      client.releaseDisconnect();
      await application.close();
    });

    it('reports liveness without querying dependencies', async () => {
      const response = await request(application.getHttpServer())
        .get('/health/live')
        .expect(200);

      expect(response.body).toEqual({ success: true, status: 'live' });
    });

    it('reports readiness when the database responds', async () => {
      const response = await request(application.getHttpServer())
        .get('/health/ready')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        status: 'ready',
        checks: { database: 'up' },
      });
    });

    it('sanitizes readiness failures', async () => {
      client.readinessError = new Error(
        'postgresql://admin:raw-secret@db.internal/aeko',
      );

      const response = await request(application.getHttpServer())
        .get('/health/ready')
        .expect(503);

      expect(response.body).toMatchObject({
        success: false,
        code: 'DATABASE_UNAVAILABLE',
        message: 'The service is temporarily unavailable.',
      });
      expect(JSON.stringify(response.body)).not.toContain('raw-secret');
    });

    it('accepts a safe request id and generates one when absent', async () => {
      const accepted = await request(application.getHttpServer())
        .get('/health/live')
        .set('x-request-id', 'request-from-edge-123')
        .expect(200);
      const generated = await request(application.getHttpServer())
        .get('/health/live')
        .expect(200);

      expect(accepted.headers['x-request-id']).toBe('request-from-edge-123');
      expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('maps malformed JSON to a friendly validation response', async () => {
      const response = await request(application.getHttpServer())
        .post('/health/live')
        .set('content-type', 'application/json')
        .send('{')
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        code: 'VALIDATION_FAILED',
        message: 'Malformed JSON request body.',
      });
      expect(response.body.requestId).toMatch(/^[0-9a-f-]{36}$/);
      expect(JSON.stringify(response.body)).not.toContain('Unexpected');
    });
  });
});
