import {
  HttpException,
  HttpStatus,
  Injectable,
  type MessageEvent,
} from '@nestjs/common';
import {
  finalize,
  interval,
  map,
  merge,
  type Observable,
  of,
  Subject,
} from 'rxjs';

export type NotificationEventType =
  | 'connected'
  | 'notification.created'
  | 'notification.read'
  | 'notification.read-all'
  | 'notification.deleted'
  | 'settings.updated'
  | 'unread-count.changed'
  | 'resync'
  | 'heartbeat';

interface UserChannel {
  readonly subject: Subject<MessageEvent>;
  connections: number;
}

@Injectable()
export class NotificationEventsService {
  private readonly channels = new Map<string, UserChannel>();
  private sequence = 0;
  private totalConnections = 0;

  public connect(
    userId: string,
    lastEventId: string | undefined,
  ): Observable<MessageEvent> {
    const existing = this.channels.get(userId);
    if ((existing?.connections ?? 0) >= 5 || this.totalConnections >= 500) {
      throw new HttpException(
        {
          success: false,
          error: 'Too many notification stream connections',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const channel = existing ?? {
      subject: new Subject<MessageEvent>(),
      connections: 0,
    };
    if (existing === undefined) this.channels.set(userId, channel);
    channel.connections += 1;
    this.totalConnections += 1;

    const initial = [
      this.event('connected', {
        userId,
        timestamp: new Date().toISOString(),
      }),
      ...(lastEventId === undefined
        ? []
        : [
            this.event('resync', {
              reason: 'process-local event replay is unavailable',
              lastEventId,
            }),
          ]),
    ];
    const heartbeat = interval(25_000).pipe(
      map(() =>
        this.event('heartbeat', {
          timestamp: new Date().toISOString(),
        }),
      ),
    );

    return merge(of(...initial), channel.subject.asObservable(), heartbeat).pipe(
      finalize(() => {
        channel.connections -= 1;
        this.totalConnections -= 1;
        if (channel.connections === 0) {
          channel.subject.complete();
          this.channels.delete(userId);
        }
      }),
    );
  }

  public publish(
    userId: string,
    type: NotificationEventType,
    data: Readonly<Record<string, unknown>>,
  ): void {
    this.channels.get(userId)?.subject.next(this.event(type, data));
  }

  public activeConnections(userId: string): number {
    return this.channels.get(userId)?.connections ?? 0;
  }

  private event(
    type: NotificationEventType,
    data: Readonly<Record<string, unknown>>,
  ): MessageEvent {
    this.sequence += 1;
    return {
      id: `${this.sequence}`,
      type,
      retry: 3_000,
      data: {
        ...data,
        timestamp: Reflect.get(data, 'timestamp') ?? new Date().toISOString(),
      },
    };
  }
}
