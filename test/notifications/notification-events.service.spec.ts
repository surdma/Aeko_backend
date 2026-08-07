import { HttpException } from '@nestjs/common';
import { firstValueFrom, skip, take, toArray } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { NotificationEventsService } from '../../src/modules/notifications/notification-events.service.js';

describe('NotificationEventsService', () => {
  it('publishes events only to the addressed user', async () => {
    const events = new NotificationEventsService();
    const userOne = events.connect('user-1', undefined);
    const userTwo = events.connect('user-2', undefined);
    const oneResult = firstValueFrom(userOne.pipe(skip(1), take(1)));
    const twoInitial = firstValueFrom(userTwo.pipe(take(1)));

    events.publish('user-1', 'notification.created', { notificationId: 'n-1' });

    await expect(oneResult).resolves.toMatchObject({
      type: 'notification.created',
      data: expect.objectContaining({ notificationId: 'n-1' }),
    });
    await expect(twoInitial).resolves.toMatchObject({
      type: 'connected',
      data: expect.objectContaining({ userId: 'user-2' }),
    });
  });

  it('emits resync after reconnecting with Last-Event-ID', async () => {
    const events = new NotificationEventsService();

    const initial = await firstValueFrom(
      events.connect('user-1', '42').pipe(take(2), toArray()),
    );

    expect(initial.map((event) => event.type)).toEqual(['connected', 'resync']);
    expect(initial[1]?.data).toEqual(
      expect.objectContaining({ lastEventId: '42' }),
    );
  });

  it('removes a user channel after the final subscriber disconnects', async () => {
    const events = new NotificationEventsService();
    const subscription = events.connect('user-1', undefined).subscribe();
    expect(events.activeConnections('user-1')).toBe(1);

    subscription.unsubscribe();

    expect(events.activeConnections('user-1')).toBe(0);
  });

  it('limits concurrent streams per user', () => {
    const events = new NotificationEventsService();
    const subscriptions = Array.from({ length: 5 }, () =>
      events.connect('user-1', undefined).subscribe(),
    );

    expect(() => events.connect('user-1', undefined)).toThrowError(HttpException);

    for (const subscription of subscriptions) subscription.unsubscribe();
  });
});
