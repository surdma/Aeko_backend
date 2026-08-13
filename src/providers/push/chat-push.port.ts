export interface ChatPushInput {
  eventId: string;
  userId: string;
  title: string;
  body: string;
}
export abstract class ChatPushPort {
  abstract deliver(input: ChatPushInput): Promise<void>;
}
