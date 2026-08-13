import { Injectable } from '@nestjs/common';
import { DomainError } from '../../common/errors/domain.error';
import { ChatAiPort } from './chat-ai.port';
@Injectable()
export class UnavailableChatAiAdapter extends ChatAiPort {
  private unavailable(): DomainError {
    return new DomainError(
      'PROVIDER_UNAVAILABLE',
      'AI service is temporarily unavailable',
    );
  }
  reply(): Promise<never> {
    return Promise.reject(this.unavailable());
  }
  summarize(): Promise<never> {
    return Promise.reject(this.unavailable());
  }
  generateImage(): Promise<never> {
    return Promise.reject(this.unavailable());
  }
  scoreDebate(): Promise<never> {
    return Promise.reject(this.unavailable());
  }
}
