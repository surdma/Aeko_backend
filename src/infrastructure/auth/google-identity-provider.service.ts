import { Inject, Injectable } from '@nestjs/common';
import { OAuth2Client, type TokenPayload } from 'google-auth-library';
import { APP_CONFIGURATION, type AppConfiguration } from '../../config/configuration.js';
import type { GoogleIdentity } from '../../modules/auth/authentication.types.js';
import type { GoogleIdentityProvider } from '../../modules/auth/google-identity-provider.port.js';

function identityFromPayload(payload: TokenPayload | undefined): GoogleIdentity {
  if (payload?.sub === undefined || payload.sub.length === 0) {
    throw new Error('Google identity payload did not contain a subject');
  }
  return {
    providerId: payload.sub,
    email: payload.email?.toLowerCase() ?? null,
    name: payload.name ?? null,
    photo: payload.picture ?? null,
  };
}

@Injectable()
export class GoogleIdentityProviderService implements GoogleIdentityProvider {
  private readonly client: OAuth2Client | null;
  private readonly clientId: string | null;

  public constructor(@Inject(APP_CONFIGURATION) configuration: AppConfiguration) {
    const google = configuration.auth.google;
    this.clientId = google.clientId;
    this.client =
      google.clientId !== null &&
      google.clientSecret !== null &&
      google.callbackUrl !== null
        ? new OAuth2Client(google.clientId, google.clientSecret, google.callbackUrl)
        : null;
  }

  public isConfigured(): boolean {
    return this.client !== null && this.clientId !== null;
  }

  public createAuthorizationUrl(): string {
    return this.requiredClient().generateAuthUrl({
      scope: ['openid', 'profile', 'email'],
      prompt: 'select_account',
    });
  }

  public async exchangeAuthorizationCode(code: string): Promise<GoogleIdentity> {
    const client = this.requiredClient();
    const { tokens } = await client.getToken(code);
    if (tokens.id_token === null || tokens.id_token === undefined) {
      throw new Error('Google authorization response did not contain an ID token');
    }
    return this.verifyIdToken(tokens.id_token);
  }

  public async verifyIdToken(idToken: string): Promise<GoogleIdentity> {
    const clientId = this.clientId;
    if (clientId === null) throw new Error('Google OAuth not configured');
    const ticket = await this.requiredClient().verifyIdToken({
      idToken,
      audience: clientId,
    });
    return identityFromPayload(ticket.getPayload());
  }

  private requiredClient(): OAuth2Client {
    if (this.client === null) throw new Error('Google OAuth not configured');
    return this.client;
  }
}
