import {
  Controller,
  Header,
  Headers,
  type MessageEvent,
  Sse,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import type { AppAuthenticatedUser } from '../../common/authentication/app-authenticated-user.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { NotificationEventsService } from './notification-events.service.js';

@Controller('api/notifications')
export class NotificationStreamController {
  public constructor(private readonly events: NotificationEventsService) {}

  @Sse('stream')
  @Header('Cache-Control', 'no-cache, no-transform')
  @Header('Connection', 'keep-alive')
  @Header('X-Accel-Buffering', 'no')
  public stream(
    @CurrentUser() user: AppAuthenticatedUser,
    @Headers('last-event-id') lastEventId: string | undefined,
  ): Observable<MessageEvent> {
    return this.events.connect(user.id, lastEventId);
  }
}
