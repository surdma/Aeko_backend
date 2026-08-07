import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaNotificationsRepository } from '../../src/infrastructure/prisma/repositories/prisma-notifications.repository.js';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';

const prisma = {
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  notification: {
    findMany: vi.fn(),
    count: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
  },
};

describe('PrismaNotificationsRepository', () => {
  let repository: PrismaNotificationsRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new PrismaNotificationsRepository(
      prisma as unknown as PrismaService,
    );
  });

  it('preserves Prisma undefined-as-omitted behavior for an empty settings body', async () => {
    vi.mocked(prisma.user.update).mockResolvedValue({
      notificationSettings: { global: { pauseAll: false } },
    });

    await repository.updateUserSettings('user-1', undefined);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {},
      select: { notificationSettings: true },
    });
  });

  it('does not convert an ambiguous null settings body into a successful JSON-null write', async () => {
    await expect(
      repository.updateUserSettings('user-1', null),
    ).rejects.toThrow('Notification settings cannot be null');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('uses the exact inbox filter, ordering, projection and pagination', async () => {
    vi.mocked(prisma.notification.findMany).mockResolvedValue([]);
    vi.mocked(prisma.notification.count).mockResolvedValue(0);

    await repository.listNotifications({
      userId: 'user-1',
      page: 2,
      limit: 20,
      type: 'LIKE',
    });

    expect(prisma.notification.findMany).toHaveBeenCalledWith({
      where: { recipientId: 'user-1', type: 'LIKE' },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            name: true,
            profilePicture: true,
            blueTick: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      skip: 20,
    });
    expect(prisma.notification.count).toHaveBeenCalledWith({
      where: { recipientId: 'user-1', type: 'LIKE' },
    });
  });
});
