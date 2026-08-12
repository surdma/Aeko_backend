import { Injectable } from '@nestjs/common';
import { DomainError } from '../common/errors/domain.error';

export interface ChatMembershipPort {
  isMember(chatId: string, userId: string): Promise<boolean>;
  invalidate(chatId: string, userId: string): Promise<void>;
}

@Injectable()
export class ChatAuthorizationService {
  constructor(private readonly memberships: ChatMembershipPort) {}

  async assertMember(userId: string, chatId: string): Promise<void> {
    if (!(await this.memberships.isMember(chatId, userId))) {
      throw new DomainError('AUTHORIZATION_DENIED', 'Chat membership is required.');
    }
  }

  invalidate(chatId: string, userId: string): Promise<void> {
    return this.memberships.invalidate(chatId, userId);
  }
}
