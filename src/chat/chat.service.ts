import { Injectable } from '@nestjs/common';
import type { AuthenticatedPrincipal } from '../auth/auth.types';
import type { ChatCommand } from './chat.contract';
import type { ChatStore, PersistedChatMessage } from './chat-prisma.client';
import { ChatAuthorizationService } from './chat-authorization.service';

export type SendMessageInput = ChatCommand;

export type CoreChatOperation =
  | 'createChat' | 'listConversations' | 'deleteConversation'
  | 'listMessages' | 'editMessage' | 'deleteMessage' | 'replyToMessage'
  | 'searchMessages' | 'addReaction' | 'removeReaction' | 'markRead'
  | 'listEmojis' | 'listUsers' | 'getInvite' | 'joinGroup'
  | 'leaveGroup' | 'removeGroupMember' | 'legacyChat' | 'legacySendMessage';

export interface CoreChatApplicationPort {
  execute(
    operation: CoreChatOperation,
    principal: AuthenticatedPrincipal,
    input: Readonly<Record<string, unknown>>,
  ): Promise<unknown>;
}

@Injectable()
export class ChatService {
  constructor(
    private readonly store: ChatStore,
    private readonly authorization: ChatAuthorizationService,
    private readonly application?: CoreChatApplicationPort,
  ) {}

  async sendMessage(
    principal: AuthenticatedPrincipal,
    input: SendMessageInput,
  ): Promise<PersistedChatMessage> {
    await this.authorization.assertMember(principal.userId, input.chatId);
    if (input.receiverId !== undefined) {
      await this.authorization.assertMember(input.receiverId, input.chatId);
    }
    return this.store.appendMessage({
      ...input,
      attachments: [...(input.attachments ?? [])],
      principalId: principal.userId,
    });
  }

  async execute(
    operation: CoreChatOperation,
    principal: AuthenticatedPrincipal,
    input: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    if (this.application === undefined) {
      throw new Error('Core chat application port is not configured');
    }
    return this.application.execute(operation, principal, input);
  }
}
