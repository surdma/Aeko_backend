import { Injectable } from '@nestjs/common';

export interface RealtimePressureMetrics {
  readonly droppedEphemeral: number;
  readonly acceptedDurable: number;
  readonly lostAcknowledgedMessages: number;
}

@Injectable()
export class RealtimeBackpressureService {
  private ephemeralInFlight = 0;
  private droppedEphemeral = 0;
  private acceptedDurable = 0;
  private lostAcknowledgedMessages = 0;

  constructor(private readonly ephemeralLimit = 64) {}

  async ephemeral(operation: () => Promise<void>): Promise<boolean> {
    if (this.ephemeralInFlight >= this.ephemeralLimit) {
      this.droppedEphemeral += 1;
      return false;
    }
    this.ephemeralInFlight += 1;
    try {
      await operation();
      return true;
    } finally {
      this.ephemeralInFlight -= 1;
    }
  }

  async durable<T>(operation: () => Promise<T>): Promise<T> {
    const result = await operation();
    this.acceptedDurable += 1;
    return result;
  }

  recordAcknowledgedLoss(): void {
    this.lostAcknowledgedMessages += 1;
  }

  snapshot(): RealtimePressureMetrics {
    return Object.freeze({
      droppedEphemeral: this.droppedEphemeral,
      acceptedDurable: this.acceptedDurable,
      lostAcknowledgedMessages: this.lostAcknowledgedMessages,
    });
  }
}
