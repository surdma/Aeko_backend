import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { LegacyApiThrottlerExceptionFilter } from '../../common/legacy-api-throttler-exception.filter.js';
import { legacyAuthFailure, securityRequestContext } from './authentication-http.js';
import { LegacyAuthBodyPipe } from './legacy-auth-body.pipe.js';
import { loginSchema, type LoginInput } from './authentication.schemas.js';
import { SessionAuthenticationService } from './session-authentication.service.js';

@Controller('api/v0/auth')
@UseGuards(ThrottlerGuard)
@UseFilters(LegacyApiThrottlerExceptionFilter)
export class SessionAuthenticationController {
  public constructor(private readonly sessions: SessionAuthenticationService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  public async login(
    @Body(
      new LegacyAuthBodyPipe(loginSchema, {
        success: false,
        message: 'Email and password are required',
      }),
    )
    input: LoginInput,
    @Req() request: Request,
  ): Promise<Readonly<Record<string, unknown>>> {
    const result = await this.sessions.login(input, securityRequestContext(request));
    switch (result.kind) {
      case 'authenticated':
        return {
          success: true,
          message: 'Login successful',
          token: result.token,
          deepLink: `aeko://(home)?token=${result.token}`,
          user: result.user,
        };
      case 'invalid-credentials':
        return legacyAuthFailure(HttpStatus.UNAUTHORIZED, {
          success: false,
          message: 'Invalid credentials',
        });
      case 'email-not-verified':
        return legacyAuthFailure(HttpStatus.UNAUTHORIZED, {
          success: false,
          message: 'Please verify your email before logging in',
          emailVerified: false,
          userId: result.userId,
        });
      case 'account-suspended':
        return legacyAuthFailure(HttpStatus.FORBIDDEN, {
          success: false,
          message: 'Your account has been suspended. Contact support.',
        });
      case 'two-factor-required':
        return {
          success: false,
          message: '2FA verification required',
          requires2FA: true,
          userId: result.userId,
        };
      case 'invalid-second-factor':
        return legacyAuthFailure(HttpStatus.UNAUTHORIZED, {
          success: false,
          message: 'Invalid 2FA token or backup code',
          requires2FA: true,
        });
      case 'unexpected':
        return legacyAuthFailure(HttpStatus.INTERNAL_SERVER_ERROR, {
          success: false,
          message: 'Login failed',
        });
    }
  }
}
