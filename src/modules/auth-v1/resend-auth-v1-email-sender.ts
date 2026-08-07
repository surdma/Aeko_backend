import { appendFile } from 'node:fs/promises';
import { Inject, Injectable } from '@nestjs/common';
import { Resend } from 'resend';
import { SanitizedLogger } from '../../common/sanitized-logger.js';
import {
  APP_CONFIGURATION,
  type AppConfiguration,
} from '../../config/configuration.js';
import type {
  AuthV1EmailMessage,
  AuthV1EmailSender,
} from './auth-v1-email-sender.port.js';

@Injectable()
export class ResendAuthV1EmailSender implements AuthV1EmailSender {
  private readonly client: Resend | null;

  public constructor(
    @Inject(APP_CONFIGURATION)
    private readonly configuration: AppConfiguration,
    private readonly logger: SanitizedLogger,
  ) {
    this.client = configuration.betterAuth.resend.configured
      ? new Resend(configuration.betterAuth.resend.apiKey)
      : null;
  }

  public async send(message: AuthV1EmailMessage): Promise<void> {
    const resend = this.configuration.betterAuth.resend;
    if (this.client === null || !resend.configured) {
      const outboxPath = this.configuration.betterAuth.emailOutboxPath;
      if (outboxPath !== null) {
        await appendFile(outboxPath, `${JSON.stringify(message)}\n`, 'utf8');
        return;
      }
      this.logger.warn('Better Auth email skipped because Resend is not configured', {
        purpose: message.subject,
      });
      return;
    }

    const result = await this.client.emails.send(
      {
        from: resend.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
      },
      { idempotencyKey: message.idempotencyKey },
    );

    if (result.error !== null) {
      this.logger.error('Resend failed to deliver a Better Auth email', {
        purpose: message.subject,
        providerError: {
          name: result.error.name,
          message: result.error.message,
        },
      });
      throw new Error('Better Auth email delivery failed');
    }
  }
}
