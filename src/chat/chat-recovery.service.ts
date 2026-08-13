import { Injectable } from '@nestjs/common';
import { ChatAuthorizationService } from './chat-authorization.service';
import type { PersistedChatMessage } from './chat-prisma.client';

export abstract class ChatRecoveryStore {
  abstract after(
    chatId: string,
    sequence: bigint,
    limit: number,
  ): Promise<readonly PersistedChatMessage[]>;
}

@Injectable()
export class ChatRecoveryService {
  constructor(
    private readonly store: ChatRecoveryStore,
    private readonly authorization: ChatAuthorizationService,
  ) {}
  async after(userId: string, chatId: string, sequence: bigint, limit = 100) {
    await this.authorization.assertMember(userId, chatId);
    return this.store.after(
      chatId,
      sequence,
      Math.min(Math.max(limit, 1), 100),
    );
  }
}
