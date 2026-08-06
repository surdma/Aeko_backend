import { describe, expect, it } from 'vitest';
import {
  ConfigurationValidationError,
  loadConfiguration,
} from '../../src/config/configuration.js';

const validEnvironment = {
  DATABASE_URL: 'postgresql://user:password@localhost:5432/aeko_test',
} as const;

describe('loadConfiguration', () => {
  it('fails closed when DATABASE_URL is missing', () => {
    expect(() => loadConfiguration({})).toThrow(ConfigurationValidationError);
  });

  it('rejects non-PostgreSQL database protocols', () => {
    expect(() =>
      loadConfiguration({ DATABASE_URL: 'mysql://localhost/aeko' }),
    ).toThrow('DATABASE_URL must use the PostgreSQL protocol');
  });

  it('normalizes typed defaults and CORS origins', () => {
    const configuration = loadConfiguration({
      ...validEnvironment,
      PORT: '4000',
      CORS_ORIGINS: 'https://aeko.social, https://admin.aeko.social ',
      TRUST_PROXY: '1',
    });

    expect(configuration.app.port).toBe(4000);
    expect(configuration.http.trustProxy).toBe(1);
    expect(configuration.http.corsOrigins).toEqual([
      'https://aeko.social',
      'https://admin.aeko.social',
    ]);
  });
});
