import { Injectable } from '@nestjs/common';
import type { IncomingHttpHeaders } from 'node:http';
import type { AekoAuth } from '../lib/auth/auth.config';
import { createAuthenticatedPrincipal } from './auth.policy';
import type { AuthenticatedPrincipal } from './auth.types';

export interface PrincipalResolver {
  resolvePrincipal(
    headers: IncomingHttpHeaders,
  ): Promise<AuthenticatedPrincipal | undefined>;
}

@Injectable()
export class AuthRuntimeService implements PrincipalResolver {
  private auth: AekoAuth | undefined;

  initialize(auth: AekoAuth): void {
    if (this.auth && this.auth !== auth) {
      throw new Error('Aeko authentication runtime is already initialized.');
    }
    this.auth = auth;
  }

  async resolvePrincipal(
    incomingHeaders: IncomingHttpHeaders,
  ): Promise<AuthenticatedPrincipal | undefined> {
    if (!this.auth) {
      throw new Error('Aeko authentication runtime is not initialized.');
    }
    const result = await this.auth.api.getSession({
      headers: toWebHeaders(incomingHeaders),
    });
    if (!result) {
      return undefined;
    }
    if (!isAekoAuthUser(result.user)) {
      throw new Error('Authenticated session user does not match Aeko schema.');
    }
    return createAuthenticatedPrincipal({
      userId: result.user.id,
      email: result.user.email,
      username: result.user.username,
      isAdmin: result.user.isAdmin,
      banned: result.user.banned,
      twoFactorEnabled: result.user.twoFactorEnabled ?? false,
      twoFactorSatisfied: true,
      sessionId: result.session.id,
    });
  }
}

interface AekoAuthUser {
  readonly username: string;
  readonly isAdmin: boolean;
  readonly banned: boolean;
  readonly twoFactorEnabled?: boolean | null;
}

function isAekoAuthUser(user: object): user is AekoAuthUser {
  return (
    'username' in user &&
    typeof user.username === 'string' &&
    'isAdmin' in user &&
    typeof user.isAdmin === 'boolean' &&
    'banned' in user &&
    typeof user.banned === 'boolean' &&
    (!('twoFactorEnabled' in user) ||
      user.twoFactorEnabled === null ||
      typeof user.twoFactorEnabled === 'boolean')
  );
}

function toWebHeaders(incomingHeaders: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incomingHeaders)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item);
      }
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}
