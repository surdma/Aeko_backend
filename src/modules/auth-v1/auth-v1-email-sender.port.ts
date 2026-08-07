export const AUTH_V1_EMAIL_SENDER = Symbol('AUTH_V1_EMAIL_SENDER');

export interface AuthV1EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly idempotencyKey: string;
}

export interface AuthV1EmailSender {
  send(message: AuthV1EmailMessage): Promise<void>;
}
