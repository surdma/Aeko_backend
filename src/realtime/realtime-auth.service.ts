import { Inject, Injectable } from '@nestjs/common';
import type { IncomingHttpHeaders } from 'node:http';
import type { PrincipalResolver } from '../auth/auth-runtime.service';
import type { AuthenticatedPrincipal } from '../auth/auth.types';
import { AuthRuntimeService } from '../auth/auth-runtime.service';
import { ConfigurationService } from '../configuration/configuration/configuration.service';

export interface RealtimeHandshake {
  readonly headers: IncomingHttpHeaders;
}

export type RealtimePrincipal = AuthenticatedPrincipal;

export class RealtimeAuthenticationError extends Error {
  constructor(readonly code: 'AUTHENTICATION_REQUIRED' | 'UNTRUSTED_ORIGIN') {
    super(
      code === 'AUTHENTICATION_REQUIRED'
        ? 'Authentication is required.'
        : 'The connection origin is not trusted.',
    );
  }
}

@Injectable()
export class RealtimeAuthService {
  constructor(
    private readonly configuration: ConfigurationService,
    @Inject(AuthRuntimeService)
    private readonly principalResolver: PrincipalResolver,
  ) {}

  async authenticate(handshake: RealtimeHandshake): Promise<RealtimePrincipal> {
    this.assertTrustedOrigin(handshake.headers.origin);
    const principal = await this.principalResolver.resolvePrincipal(
      handshake.headers,
    );
    if (!principal || principal.banned) {
      throw new RealtimeAuthenticationError('AUTHENTICATION_REQUIRED');
    }
    return principal;
  }

  private assertTrustedOrigin(origin: string | undefined): void {
    const trustedOrigins = this.configuration.value.trustedOrigins;
    if (trustedOrigins.length === 0) return;
    if (!origin || !trustedOrigins.includes(origin)) {
      throw new RealtimeAuthenticationError('UNTRUSTED_ORIGIN');
    }
  }
}
