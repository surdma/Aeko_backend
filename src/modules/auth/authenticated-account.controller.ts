import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentUserId } from '../../common/decorators/current-user-id.decorator.js';
import { LegacyApiThrottlerExceptionFilter } from '../../common/legacy-api-throttler-exception.filter.js';
import { AuthenticationService } from './authentication.service.js';
import { legacyAuthFailure } from './authentication-http.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';

@Controller('api/auth')
@UseGuards(ThrottlerGuard)
@UseFilters(LegacyApiThrottlerExceptionFilter)
export class AuthenticatedAccountController {
  public constructor(private readonly authentication: AuthenticationService) {}

  @Get('profile-completion')
  @UseGuards(JwtAuthGuard)
  public async profileCompletion(
    @CurrentUserId() userId: string,
  ): Promise<Readonly<Record<string, unknown>>> {
    const result = await this.authentication.profileCompletion(userId);
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
    const result = await this.authentication.currentUser(userId);
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
    response.clearCookie('token', this.authentication.logoutCookieOptions());
    return { success: true, message: 'Logged out successfully' };
  }
}
