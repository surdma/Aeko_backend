import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { callSignalSchema, CallSignal } from './video-call.contract';
import { VideoCallAuthorizationService } from './video-call-authorization.service';

type SignalEvent = 'call-offer' | 'call-answer' | 'ice-candidate';

interface SignallingSocket {
  readonly id: string;
  readonly data: { principal?: { userId?: string } };
  emit(event: string, payload: unknown): boolean;
  disconnect(close?: boolean): void;
}

interface SignalAcknowledgement {
  (payload: { success: boolean; code?: string }): void;
}

@WebSocketGateway({ namespace: '/chat' })
export class VideoCallsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly connectionsByUser = new Map<string, Set<SignallingSocket>>();
  private readonly eventTimestamps = new Map<string, number[]>();

  constructor(private readonly authorization: VideoCallAuthorizationService) {}

  handleConnection(socket: SignallingSocket): void {
    const userId = this.userId(socket);
    if (userId === undefined) {
      socket.disconnect(true);
      return;
    }

    const connections = this.connectionsByUser.get(userId) ?? new Set<SignallingSocket>();
    connections.add(socket);
    this.connectionsByUser.set(userId, connections);
  }

  handleDisconnect(socket: SignallingSocket): void {
    const userId = this.userId(socket);
    if (userId === undefined) return;

    const connections = this.connectionsByUser.get(userId);
    if (connections === undefined) return;
    connections.delete(socket);
    if (connections.size === 0) this.connectionsByUser.delete(userId);
  }

  @SubscribeMessage('call-offer')
  offer(@ConnectedSocket() socket: SignallingSocket, @MessageBody() body: unknown, acknowledgement?: SignalAcknowledgement): Promise<void> {
    return this.relay('call-offer', socket, body, acknowledgement);
  }

  @SubscribeMessage('call-answer')
  answer(@ConnectedSocket() socket: SignallingSocket, @MessageBody() body: unknown, acknowledgement?: SignalAcknowledgement): Promise<void> {
    return this.relay('call-answer', socket, body, acknowledgement);
  }

  @SubscribeMessage('ice-candidate')
  candidate(@ConnectedSocket() socket: SignallingSocket, @MessageBody() body: unknown, acknowledgement?: SignalAcknowledgement): Promise<void> {
    return this.relay('ice-candidate', socket, body, acknowledgement);
  }

  private async relay(event: SignalEvent, socket: SignallingSocket, body: unknown, acknowledgement?: SignalAcknowledgement): Promise<void> {
    try {
      const userId = this.userId(socket);
      if (userId === undefined) throw new Error('UNAUTHENTICATED');
      if (!this.withinRateLimit(userId, event)) throw new Error('RATE_LIMITED');

      const parsed = callSignalSchema.safeParse(body);
      if (!parsed.success || !this.matchesEvent(event, parsed.data)) throw new Error('INVALID_SIGNAL');
      await this.authorization.assertPeers(userId, parsed.data.targetUserId, parsed.data.chatId);

      const targetConnections = this.connectionsByUser.get(parsed.data.targetUserId);
      if (targetConnections !== undefined) {
        const payload = this.legacyPayload(userId, parsed.data);
        for (const target of targetConnections) target.emit(event, payload);
      }
      acknowledgement?.({ success: true });
    } catch (error: unknown) {
      const code = this.errorCode(error);
      socket.emit('call-error', { code });
      acknowledgement?.({ success: false, code });
    }
  }

  private userId(socket: SignallingSocket): string | undefined {
    const userId = socket.data.principal?.userId;
    return typeof userId === 'string' && userId.length > 0 ? userId : undefined;
  }

  private withinRateLimit(userId: string, event: SignalEvent): boolean {
    const key = `${userId}:${event}`;
    const now = Date.now();
    const timestamps = (this.eventTimestamps.get(key) ?? []).filter((timestamp) => now - timestamp < 30_000);
    if (timestamps.length >= 15) return false;
    timestamps.push(now);
    this.eventTimestamps.set(key, timestamps);
    return true;
  }

  private matchesEvent(event: SignalEvent, signal: CallSignal): boolean {
    return (event === 'call-offer' && signal.offer !== undefined) ||
      (event === 'call-answer' && signal.answer !== undefined) ||
      (event === 'ice-candidate' && signal.candidate !== undefined);
  }

  private legacyPayload(senderId: string, signal: CallSignal): Record<string, string> {
    const payload: Record<string, string> = { chatId: signal.chatId, senderId };
    if (signal.offer !== undefined) payload.offer = signal.offer;
    if (signal.answer !== undefined) payload.answer = signal.answer;
    if (signal.candidate !== undefined) payload.candidate = signal.candidate;
    return payload;
  }

  private errorCode(error: unknown): 'AUTHORIZATION_DENIED' | 'INVALID_SIGNAL' | 'RATE_LIMITED' | 'UNAUTHENTICATED' {
    if (error instanceof Error && error.message === 'RATE_LIMITED') return 'RATE_LIMITED';
    if (error instanceof Error && error.message === 'UNAUTHENTICATED') return 'UNAUTHENTICATED';
    if (error instanceof Error && error.message === 'INVALID_SIGNAL') return 'INVALID_SIGNAL';
    return 'AUTHORIZATION_DENIED';
  }
}
