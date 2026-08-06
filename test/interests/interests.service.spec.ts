import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SanitizedLogger } from '../../src/common/sanitized-logger.js';
import type { InterestsRepository } from '../../src/modules/interests/interests.repository.js';
import { InterestsService } from '../../src/modules/interests/interests.service.js';

const first = {
  id: 'interest-1',
  name: 'technology',
  displayName: 'Technology',
  description: '',
  icon: '',
  isActive: true,
  createdAt: new Date('2026-08-06T18:00:00.000Z'),
  updatedAt: new Date('2026-08-06T18:00:00.000Z'),
} as const;

const second = { ...first, id: 'interest-2', name: 'music', displayName: 'Music' };

describe('InterestsService', () => {
  let repository: InterestsRepository;
  let service: InterestsService;

  beforeEach(() => {
    repository = {
      listActive: vi.fn(),
      listActiveByIds: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findUserState: vi.fn(),
      updateUserInterestIds: vi.fn(),
    };
    const logger = new SanitizedLogger();
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    service = new InterestsService(repository, logger);
  });

  it('preserves the active-interest query result', async () => {
    vi.mocked(repository.listActive).mockResolvedValue([first]);
    await expect(service.listActive()).resolves.toEqual({
      kind: 'success',
      data: [first],
    });
  });

  it('normalizes only the interest name on create', async () => {
    vi.mocked(repository.create).mockResolvedValue({
      kind: 'created',
      interest: first,
    });

    await service.create({
      name: 'TECHNOLOGY',
      displayName: 'Technology',
      description: '',
      icon: '',
    });

    expect(repository.create).toHaveBeenCalledWith({
      name: 'technology',
      displayName: 'Technology',
      description: '',
      icon: '',
    });
  });

  it('preserves legacy update field selection', async () => {
    vi.mocked(repository.findById).mockResolvedValue(first);
    vi.mocked(repository.update).mockResolvedValue(first);

    await service.update(first.id, {
      displayName: '',
      description: '',
      isActive: false,
    });

    expect(repository.update).toHaveBeenCalledWith(first.id, {
      description: '',
      isActive: false,
    });
  });

  it('validates all requested IDs before updating a user', async () => {
    vi.mocked(repository.listActiveByIds).mockResolvedValue([first]);

    await expect(
      service.addForUser('user-id', [first.id, second.id]),
    ).resolves.toEqual({ kind: 'invalid-interest-ids' });
    expect(repository.findUserState).not.toHaveBeenCalled();
  });

  it('merges user interests and marks profile completion', async () => {
    vi.mocked(repository.listActiveByIds)
      .mockResolvedValueOnce([second])
      .mockResolvedValueOnce([first, second]);
    vi.mocked(repository.findUserState).mockResolvedValue({
      interestIds: [first.id],
      profileCompletion: { profilePictureUploaded: true },
    });

    await expect(
      service.addForUser('user-id', [second.id]),
    ).resolves.toEqual({ kind: 'success', data: [first, second] });
    expect(repository.updateUserInterestIds).toHaveBeenCalledWith(
      'user-id',
      [first.id, second.id],
      { profilePictureUploaded: true, interestsSelected: true },
    );
  });
});
