import type { Interest } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SanitizedLogger } from '../../src/common/sanitized-logger.js';
import type { InterestsRepository } from '../../src/interests/interests.repository.js';
import { InterestsService } from '../../src/interests/interests.service.js';

const activeInterest: Interest = {
  id: 'interest-id',
  name: 'blockchain',
  displayName: 'Blockchain',
  description: 'Distributed systems and digital assets',
  icon: 'blocks',
  isActive: true,
  createdAt: new Date('2026-08-06T18:00:00.000Z'),
  updatedAt: new Date('2026-08-06T18:00:00.000Z'),
};

describe('InterestsService', () => {
  let repository: InterestsRepository;
  let logger: SanitizedLogger;
  let service: InterestsService;

  beforeEach(() => {
    repository = {
      listActive: vi.fn(),
    };
    logger = new SanitizedLogger();
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    service = new InterestsService(repository, logger);
  });

  it('returns the active interests without changing order or fields', async () => {
    vi.mocked(repository.listActive).mockResolvedValue([activeInterest]);

    await expect(service.listActive()).resolves.toEqual({
      kind: 'loaded',
      interests: [activeInterest],
    });
  });

  it('returns a typed unexpected result and logs sanitized context', async () => {
    const error = new Error('postgresql://admin:super-secret@database.internal/aeko');
    vi.mocked(repository.listActive).mockRejectedValue(error);

    await expect(service.listActive()).resolves.toEqual({ kind: 'unexpected' });
    expect(logger.error).toHaveBeenCalledWith('Active interests query failed', {
      error,
    });
  });
});
