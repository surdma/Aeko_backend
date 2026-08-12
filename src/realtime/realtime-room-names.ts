import { Injectable } from '@nestjs/common';

@Injectable()
export class RealtimeRoomNames {
  chat(chatId: string): string {
    return `aeko:chat:${chatId}`;
  }

  user(userId: string): string {
    return `aeko:user:${userId}`;
  }
}
