import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator.js';
import { LegacyApiThrottlerExceptionFilter } from '../../common/legacy-api-throttler-exception.filter.js';
import {
  APP_CONFIGURATION,
  type AppConfiguration,
} from '../../config/configuration.js';
import { legacyAuthFailure, logoutCookieOptions } from './authentication-http.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { SessionAuthenticationService } from './session-authentication.service.js';

@Controller('api/v0/auth')
@UseGuards(ThrottlerGuard)
@UseFilters(LegacyApiThrottlerExceptionFilter)
export class AuthenticatedAccountController {
  public constructor(
    private readonly sessions: SessionAuthenticationService,
    @Inject(APP_CONFIGURATION)
    private readonly configuration: AppConfiguration,
  ) {}

  @Get('profile-completion')
  @UseGuards(JwtAuthGuard)
  public async profileCompletion(
    @CurrentUserId() userId: string,
  ): Promise<Readonly<Record<string, unknown>>> {
    const result = await this.sessions.profileCompletion(userId);
    switch (result.kind) {
      case 'found':
        return { success: true, profileCompletion: result.profileCompletion };
      case 'not-found':
        return legacyAuthFailure(HttpStatus.NOT_FOUND, {
          success: false,
          message: 'User not found',
        });
      case 'unexpected':
        return legacyAuthFailure(HttpStatus.INTERNAL_SERVER_ERROR, {
          success: false,
          message: 'Failed to get profile completion status',
        });
    }
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  public async me(
    @CurrentUserId() userId: string,
  ): Promise<Readonly<Record<string, unknown>>> {
    const result = await this.sessions.currentUser(userId);
    switch (result.kind) {
      case 'found':
        return { success: true, user: result.user };
      case 'not-found':
        return legacyAuthFailure(HttpStatus.NOT_FOUND, {
          success: false,
          message: 'User not found',
        });
      case 'unexpected':
        return legacyAuthFailure(HttpStatus.INTERNAL_SERVER_ERROR, {
          success: false,
          message: 'Failed to get user information',
        });
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  public logout(
    @Res({ passthrough: true }) response: Response,
  ): Readonly<Record<string, unknown>> {
    response.clearCookie(
      'token',
      logoutCookieOptions(this.configuration.app.environment === 'production'),
    );
    return { success: true, message: 'Logged out successfully' };
  }
}
