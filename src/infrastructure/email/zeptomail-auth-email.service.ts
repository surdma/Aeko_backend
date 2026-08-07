import { Inject, Injectable } from '@nestjs/common';
import { SendMailClient } from 'zeptomail';
import { SanitizedLogger } from '../../common/sanitized-logger.js';
import {
  APP_CONFIGURATION,
  type AppConfiguration,
} from '../../config/configuration.js';
import type { AuthEmailDelivery } from '../../modules/auth/auth-email-delivery.port.js';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function layout(title: string, username: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} - Aeko</title></head>
<body style="font-family:Inter,Arial,sans-serif;background:#f3f4f6;color:#1f2937;padding:24px">
  <main style="max-width:560px;margin:auto;background:#fff;border-radius:16px;overflow:hidden">
    <header style="padding:28px;background:#667eea;color:#fff;text-align:center"><strong style="font-size:28px">aeko</strong><div>${escapeHtml(title)}</div></header>
    <section style="padding:32px"><h2>Hi ${escapeHtml(username)} 👋</h2>${body}</section>
    <footer style="padding:20px;background:#f9fafb;text-align:center;color:#6b7280;font-size:12px">Aeko Social</footer>
  </main>
</body>
</html>`;
}

@Injectable()
export class ZeptoMailAuthEmailService implements AuthEmailDelivery {
  private readonly client: SendMailClient | null;
  private readonly senderName: string;

  public constructor(
    @Inject(APP_CONFIGURATION) configuration: AppConfiguration,
    private readonly logger: SanitizedLogger,
  ) {
    this.senderName = configuration.email.senderName;
    this.client =
      configuration.email.zeptoMailApiUrl !== null &&
      configuration.email.zeptoMailApiKey !== null
        ? new SendMailClient({
            url: configuration.email.zeptoMailApiUrl,
            token: configuration.email.zeptoMailApiKey,
          })
        : null;
  }

  public sendVerificationCode(
    email: string,
    code: string,
    username: string,
  ): Promise<boolean> {
    return this.deliver(
      email,
      username,
      '🔐 Verify your Aeko account',
      layout(
        'Verify Your Email',
        username,
        `<p>Use the four-digit code below to verify your account.</p><div style="font-size:32px;font-weight:700;letter-spacing:8px;text-align:center;padding:20px;background:#f9fafb;border-radius:12px">${escapeHtml(code)}</div><p>This code expires in 10 minutes. Never share it with anyone.</p>`,
      ),
    );
  }

  public async sendWelcomeEmail(email: string, username: string): Promise<void> {
    await this.deliver(
      email,
      username,
      '🎉 Welcome to Aeko - Your Journey Begins!',
      layout(
        'Welcome to Aeko',
        username,
        '<p>Your email has been verified successfully. Complete your profile, meet your AI assistant and connect with communities.</p>',
      ),
    );
  }

  public async sendLoginNotification(
    email: string,
    username: string,
    time: string,
    device: string,
  ): Promise<void> {
    await this.deliver(
      email,
      username,
      '🛡️ New Login Alert - Aeko',
      layout(
        'New Login Detected',
        username,
        `<p>A new login was detected.</p><p><strong>Time:</strong> ${escapeHtml(time)}<br><strong>Device:</strong> ${escapeHtml(device)}</p><p>If this was not you, change your password immediately.</p>`,
      ),
    );
  }

  public async sendPasswordResetEmail(
    email: string,
    username: string,
    resetLink: string,
  ): Promise<void> {
    await this.deliver(
      email,
      username,
      '🔑 Reset Your Aeko Password',
      layout(
        'Reset Password',
        username,
        `<p>We received a request to reset your password.</p><p><a href="${escapeHtml(resetLink)}">Reset Password</a></p><p>If you did not request this, ignore this email.</p>`,
      ),
    );
  }

  private async deliver(
    email: string,
    username: string,
    subject: string,
    htmlbody: string,
  ): Promise<boolean> {
    if (this.client === null) {
      this.logger.warn('Authentication email skipped because ZeptoMail is not configured', {
        purpose: subject,
      });
      return false;
    }

    try {
      await this.client.sendMail({
        from: { address: 'noreply@aeko.social', name: this.senderName },
        to: [
          {
            email_address: {
              address: email,
              name: username || email.split('@')[0] || email,
            },
          },
        ],
        subject,
        htmlbody,
      });
      return true;
    } catch (error: unknown) {
      this.logger.warn('Authentication email delivery failed', { purpose: subject, error });
      return false;
    }
  }
}
