import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SanitizedLogger } from '../../src/common/sanitized-logger.js';
import type { WaitlistRepository } from '../../src/modules/waitlist/waitlist.repository.js';
import { WaitlistService } from '../../src/modules/waitlist/waitlist.service.js';

const entry = {
  id: 'entry-id',
  name: 'Jane Doe',
  email: 'jane@example.com',
  createdAt: new Date('2026-08-06T18:00:00.000Z'),
} as const;

describe('WaitlistService', () => {
  let repository: WaitlistRepository;
  let service: WaitlistService;

  beforeEach(() => {
    repository = {
      findByEmail: vi.fn(),
      create: vi.fn(),
    };
    const logger = new SanitizedLogger();
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    service = new WaitlistService(repository, logger);
  });

  it('creates a new entry', async () => {
    vi.mocked(repository.findByEmail).mockResolvedValue({ kind: 'not-found' });
    vi.mocked(repository.create).mockResolvedValue({ kind: 'created', entry });

    await expect(
      service.join({ name: entry.name, email: entry.email }),
    ).resolves.toEqual({ kind: 'created', entry });
  });

  it('does not insert an existing email', async () => {
    vi.mocked(repository.findByEmail).mockResolvedValue({ kind: 'found', entry });

    await expect(
      service.join({ name: entry.name, email: entry.email }),
    ).resolves.toEqual({ kind: 'duplicate' });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('preserves database-unavailable behavior', async () => {
    vi.mocked(repository.findByEmail).mockResolvedValue({
      kind: 'database-unavailable',
    });

    await expect(
      service.join({ name: entry.name, email: entry.email }),
    ).resolves.toEqual({ kind: 'database-unavailable' });
  });
});
