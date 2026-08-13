export interface BotUsageRecord {
  userId: string;
  operation: string;
  provider: string;
  tokens: number;
  responseTimeMs: number;
}
export abstract class BotStore {
  abstract recordUsage(record: BotUsageRecord): Promise<void>;
  abstract execute(
    userId: string,
    operation: string,
    input: Readonly<Record<string, unknown>>,
  ): Promise<unknown>;
}
