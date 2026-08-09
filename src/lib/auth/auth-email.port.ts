export interface AuthEmailMessage {
  readonly kind: 'email-verification' | 'password-reset';
  readonly recipient: string;
  readonly url: string;
}

export interface AuthEmailPort {
  deliver(message: AuthEmailMessage): Promise<void>;
}
