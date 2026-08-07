import {
  Controller,
  Header,
  Headers,
  type MessageEvent,
  Sse,
  UseGuards,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { AuthV1Guard } from '../auth-v1/auth-v1.guard.js';
import { CurrentAuthV1User } from '../auth-v1/current-auth-v1-user.decorator.js';
import type { AuthV1SessionUser } from '../auth-v1/better-auth-v1.service.js';
import { NotificationEventsService } from './notification-events.service.js';

@Controller('api/notifications')
@UseGuards(AuthV1Guard)
export class NotificationStreamController {
  public constructor(private readonly events: NotificationEventsService) {}

  @Sse('stream')
  @Header('Cache-Control', 'no-cache, no-transform')
  @Header('Connection', 'keep-alive')
  @Header('X-Accel-Buffering', 'no')
  public stream(
    @CurrentAuthV1User() user: AuthV1SessionUser,
    @Headers('last-event-id') lastEventId: string | undefined,
  ): Observable<MessageEvent> {
    return this.events.connect(user.id, lastEventId);
  }
}
