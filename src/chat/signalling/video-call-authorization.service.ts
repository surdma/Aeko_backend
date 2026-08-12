import { Injectable } from '@nestjs/common';
import { DomainError } from '../../common/errors/domain.error';
import { ChatAuthorizationService } from '../chat-authorization.service';

@Injectable()
export class VideoCallAuthorizationService {
  constructor(private readonly chatAuthorization: ChatAuthorizationService) {}

  async assertPeers(callerId: string, targetId: string, chatId: string): Promise<void> {
    const [caller, target] = await Promise.all([
      this.isMember(callerId, chatId),
      this.isMember(targetId, chatId),
    ]);

    if (!caller || !target) {
      throw new DomainError('AUTHORIZATION_DENIED', 'Call not permitted');
    }
  }

  private async isMember(userId: string, chatId: string): Promise<boolean> {
    try {
      await this.chatAuthorization.assertMember(userId, chatId);
      return true;
    } catch {
      return false;
    }
  }
}
