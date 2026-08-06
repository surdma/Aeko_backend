import type { WaitlistEntry } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SanitizedLogger } from '../../src/common/sanitized-logger.js';
import type { WaitlistRepository } from '../../src/waitlist/waitlist.repository.js';
import { WaitlistService } from '../../src/waitlist/waitlist.service.js';

const entry: WaitlistEntry = {
  id: 'waitlist-entry-id',
  name: 'Jane Doe',
  email: 'jane@example.com',
  createdAt: new Date('2026-08-06T18:00:00.000Z'),
};

describe('WaitlistService', () => {
  let repository: WaitlistRepository;
  let logger: SanitizedLogger;
  let service: WaitlistService;

  beforeEach(() => {
    repository = {
      findByEmail: vi.fn(),
      create: vi.fn(),
    };
    logger = new SanitizedLogger();
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    service = new WaitlistService(repository, logger);
  });

  it('creates a new entry after confirming the email is absent', async () => {
    vi.mocked(repository.findByEmail).mockResolvedValue(null);
    vi.mocked(repository.create).mockResolvedValue(entry);

    await expect(
      service.join({ name: entry.name, email: entry.email }),
    ).resolves.toEqual({
      kind: 'created',
      entry,
    });
    expect(repository.findByEmail).toHaveBeenCalledWith(entry.email);
    expect(repository.create).toHaveBeenCalledWith({
      name: entry.name,
      email: entry.email,
    });
  });

  it('returns duplicate without attempting another insert', async () => {
    vi.mocked(repository.findByEmail).mockResolvedValue(entry);

    await expect(
      service.join({ name: entry.name, email: entry.email }),
    ).resolves.toEqual({ kind: 'duplicate' });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('maps database reachability failures to the stable unavailable result', async () => {
    vi.mocked(repository.findByEmail).mockRejectedValue(
      new Error("Can't reach database server at database.internal"),
    );

    await expect(
      service.join({ name: entry.name, email: entry.email }),
    ).resolves.toEqual({ kind: 'database-unavailable' });
  });

  it('logs unexpected failures without exposing them through the result', async () => {
    const unexpected = new Error('provider-password=super-secret');
    vi.mocked(repository.findByEmail).mockRejectedValue(unexpected);

    await expect(
      service.join({ name: entry.name, email: entry.email }),
    ).resolves.toEqual({ kind: 'unexpected' });
    expect(logger.error).toHaveBeenCalledWith('Waitlist signup failed', {
      error: unexpected,
    });
  });
});
