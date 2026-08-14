import { Injectable } from '@nestjs/common';
import { DomainError } from '../../common/errors/domain.error';
import { BotStore, type BotUsageRecord } from './bot-prisma.client';

@Injectable()
export class UnavailableBotStore extends BotStore {
  recordUsage(_record: BotUsageRecord): Promise<void> {
    return Promise.resolve();
  }

  execute(): Promise<never> {
    return Promise.reject(
      new DomainError(
        'PROVIDER_UNAVAILABLE',
        'Bot service is temporarily unavailable',
      ),
    );
  }
}
