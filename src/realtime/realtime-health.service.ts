import { Injectable } from '@nestjs/common';

export interface RealtimeHealthSnapshot {
  readonly adapter: 'ready' | 'degraded' | 'disabled';
  readonly presence: 'ready' | 'degraded';
  readonly rateLimits: 'distributed' | 'local-safe-mode';
  readonly lastErrorCode: string | null;
}

@Injectable()
export class RealtimeHealthService {
  private adapter: RealtimeHealthSnapshot['adapter'] = 'degraded';
  private presence: RealtimeHealthSnapshot['presence'] = 'degraded';
  private rateLimits: RealtimeHealthSnapshot['rateLimits'] = 'local-safe-mode';
  private lastErrorCode: string | null = null;

  snapshot(): RealtimeHealthSnapshot {
    return Object.freeze({
      adapter: this.adapter,
      presence: this.presence,
      rateLimits: this.rateLimits,
      lastErrorCode: this.lastErrorCode,
    });
  }

  markRedisReady(): void {
    this.presence = 'ready';
    this.rateLimits = 'distributed';
    this.lastErrorCode = null;
  }

  markAdapterReady(): void {
    this.adapter = 'ready';
    this.lastErrorCode = null;
  }

  markDisabled(): void {
    this.adapter = 'disabled';
    this.presence = 'degraded';
    this.rateLimits = 'local-safe-mode';
  }

  markDegraded(code: string): void {
    this.adapter = 'degraded';
    this.presence = 'degraded';
    this.rateLimits = 'local-safe-mode';
    this.lastErrorCode = code;
  }
}
