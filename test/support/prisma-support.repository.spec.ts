import { describe, expect, it, vi } from 'vitest';
import { PrismaSupportRepository } from '../../src/infrastructure/prisma/repositories/prisma-support.repository.js';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';

const sender = {
  id: 'admin',
  username: 'admin',
  name: 'Admin',
  profilePicture: null,
  isAdmin: true,
} as const;

const message = {
  id: 'message-1',
  ticketId: 'ticket-1',
  senderId: sender.id,
  message: 'We are investigating',
  attachments: [],
  createdAt: new Date('2026-08-06T18:00:00.000Z'),
  sender,
} as const;

describe('PrismaSupportRepository', () => {
  it('creates a reply and its status transition in one transaction', async () => {
    const create = vi.fn(async () => message);
    const update = vi.fn(async () => ({ id: message.ticketId }));
    const transactionClient = {
      supportMessage: { create },
      supportTicket: { update },
    };
    const transaction = vi.fn(
      async (
        operation: (
          client: typeof transactionClient,
        ) => Promise<typeof message>,
      ) => operation(transactionClient),
    );
    const prisma = { $transaction: transaction } as unknown as PrismaService;
    const repository = new PrismaSupportRepository(prisma);

    await expect(
      repository.createMessageWithStatus({
        ticketId: message.ticketId,
        senderId: message.senderId,
        message: message.message,
        attachments: [],
        nextStatus: 'in_progress',
      }),
    ).resolves.toEqual(message);

    expect(transaction).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith({
      where: { id: message.ticketId },
      data: { status: 'in_progress' },
    });
  });
});
