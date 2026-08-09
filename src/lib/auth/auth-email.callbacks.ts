import type { AuthEmailPort } from './auth-email.port';

export interface BetterAuthEmailDelivery {
  readonly user: { readonly email: string };
  readonly url: string;
}

export function createAuthEmailCallbacks(emailPort: AuthEmailPort) {
  return Object.freeze({
    sendVerificationEmail: async (
      delivery: BetterAuthEmailDelivery,
    ): Promise<void> => {
      await deliver(emailPort, {
        kind: 'email-verification',
        recipient: delivery.user.email,
        url: delivery.url,
      });
    },
    sendResetPassword: async (
      delivery: BetterAuthEmailDelivery,
    ): Promise<void> => {
      await deliver(emailPort, {
        kind: 'password-reset',
        recipient: delivery.user.email,
        url: delivery.url,
      });
    },
  });
}

async function deliver(
  emailPort: AuthEmailPort,
  message: Parameters<AuthEmailPort['deliver']>[0],
): Promise<void> {
  try {
    await emailPort.deliver(Object.freeze({ ...message }));
  } catch {
    throw new Error('Authentication email delivery failed.');
  }
}
