/* eslint-disable @typescript-eslint/require-await -- async callbacks model queued work */
import { RealtimeBackpressureService } from '../../src/realtime/realtime-backpressure.service';

describe('realtime backpressure', () => {
  it('drops excess ephemeral work without starving durable messages', async () => {
    const pressure = new RealtimeBackpressureService(4);
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ephemeral = Array.from({ length: 10_000 }, () =>
      pressure.ephemeral(async () => blocked),
    );

    const acknowledgement = await pressure.durable(async () => ({
      success: true,
    }));
    release?.();
    await Promise.all(ephemeral);

    expect(acknowledgement).toEqual({ success: true });
    expect(pressure.snapshot()).toEqual({
      droppedEphemeral: 9_996,
      acceptedDurable: 1,
      lostAcknowledgedMessages: 0,
    });
  });
});
