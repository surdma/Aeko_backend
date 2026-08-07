import { describe, expect, it } from 'vitest';
import {
  ConfigurationValidationError,
  loadConfiguration,
} from '../../src/config/configuration.js';

const validEnvironment = {
  DATABASE_URL: 'postgresql://user:password@localhost:5432/aeko_test',
  JWT_SECRET: 'test-jwt-secret-with-at-least-32-characters',
  TWO_FACTOR_SECRET_KEY: 'test-two-factor-secret-key-32chars',
} as const;

describe('loadConfiguration', () => {
  it('fails closed when required persistence or auth values are missing', () => {
    expect(() => loadConfiguration({})).toThrow(ConfigurationValidationError);
  });

  it('rejects non-PostgreSQL database protocols', () => {
    expect(() =>
      loadConfiguration({
        ...validEnvironment,
        DATABASE_URL: 'mysql://localhost/aeko',
      }),
    ).toThrow('DATABASE_URL must use the PostgreSQL protocol');
  });

  it('defaults application authentication to Better Auth', () => {
    expect(loadConfiguration(validEnvironment).authentication.mode).toBe(
      'better-auth',
    );
  });

  it('allows the legacy v0 authority to be selected explicitly', () => {
    expect(
      loadConfiguration({ ...validEnvironment, AUTH_MODE: 'v0' }).authentication
        .mode,
    ).toBe('v0');
  });

  it('normalizes typed defaults, auth values and CORS origins', () => {
    const configuration = loadConfiguration({
      ...validEnvironment,
      PORT: '4000',
      CORS_ORIGINS: 'https://aeko.social, https://admin.aeko.social ',
      TRUST_PROXY: '1',
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      ZEPTOMAIL_API_KEY: '',
    });

    expect(configuration.app.port).toBe(4000);
    expect(configuration.http.trustProxy).toBe(1);
    expect(configuration.auth.jwtSecret).toBe(validEnvironment.JWT_SECRET);
    expect(configuration.auth.google.clientId).toBeNull();
    expect(configuration.auth.google.clientSecret).toBeNull();
    expect(configuration.email.zeptoMailApiKey).toBeNull();
    expect(configuration.http.corsOrigins).toEqual([
      'https://aeko.social',
      'https://admin.aeko.social',
    ]);
  });
});
