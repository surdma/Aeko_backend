import { Injectable } from '@nestjs/common';
import { DomainError } from '../common/errors/domain.error';
import { PrismaService } from '../database/prisma/prisma.service';
import { ChatMembershipPort } from './chat-authorization.service';
import { ChatStore, createChatPrismaClient } from './chat-prisma.client';
import { ChatRecoveryStore } from './chat-recovery.service';
import type { SendMessageCommand } from './chat.contract';

@Injectable()
export class PrismaChatStore extends ChatStore {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  appendMessage(command: SendMessageCommand) {
    return createChatPrismaClient(this.prisma.db).appendMessage(command);
  }
}

@Injectable()
export class PrismaChatMembershipPort extends ChatMembershipPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async isMember(chatId: string, userId: string): Promise<boolean> {
    return (
      (await this.prisma.db.chatMember.findUnique({
        where: { chatId_userId: { chatId, userId } },
        select: { id: true },
      })) !== null
    );
  }

  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

@Injectable()
export class PrismaChatRecoveryStore extends ChatRecoveryStore {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async after(chatId: string, sequence: bigint, limit: number) {
    const rows = await this.prisma.db.enhancedMessage.findMany({
      where: { chatId, sequence: { gt: sequence } },
      orderBy: { sequence: 'asc' },
      take: limit,
      select: {
        id: true,
        chatId: true,
        clientMessageId: true,
        sequence: true,
        createdAt: true,
      },
    });
    return rows.map((row) => {
      if (row.sequence === null) {
        throw new DomainError(
          'DATABASE_UNAVAILABLE',
          'Chat sequence is unavailable',
        );
      }
      return { ...row, sequence: row.sequence };
    });
  }
}
