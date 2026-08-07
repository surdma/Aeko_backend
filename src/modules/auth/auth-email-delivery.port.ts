export interface AuthEmailDelivery {
  sendVerificationCode(email: string, code: string, username: string): Promise<boolean>;
  sendWelcomeEmail(email: string, username: string): Promise<void>;
  sendLoginNotification(
    email: string,
    username: string,
    time: string,
    device: string,
  ): Promise<void>;
  sendPasswordResetEmail(
    email: string,
    username: string,
    resetLink: string,
  ): Promise<void>;
}

export const AUTH_EMAIL_DELIVERY = Symbol('AUTH_EMAIL_DELIVERY');
