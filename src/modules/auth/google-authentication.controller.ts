import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Redirect,
  Res,
  UseFilters,
  UseGuards,
  type HttpRedirectResponse,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { LegacyApiThrottlerExceptionFilter } from '../../common/legacy-api-throttler-exception.filter.js';
import { AuthenticationService } from './authentication.service.js';
import { GOOGLE_NOT_CONFIGURED, legacyAuthFailure } from './authentication-http.js';
import { mobileGoogleSchema } from './authentication.schemas.js';

@Controller('api/auth')
@UseGuards(ThrottlerGuard)
@UseFilters(LegacyApiThrottlerExceptionFilter)
export class GoogleAuthenticationController {
  public constructor(private readonly authentication: AuthenticationService) {}

  @Get('google')
  @Redirect()
  public google(): HttpRedirectResponse {
    const url = this.authentication.googleAuthorizationUrl();
    if (url === null) {
      legacyAuthFailure(HttpStatus.SERVICE_UNAVAILABLE, GOOGLE_NOT_CONFIGURED);
    }
    return { url, statusCode: HttpStatus.FOUND };
  }

  @Get('google/callback')
  @Redirect()
  public async callback(
    @Query('code') code: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<HttpRedirectResponse> {
    if (!this.authentication.isGoogleConfigured()) {
      legacyAuthFailure(HttpStatus.SERVICE_UNAVAILABLE, GOOGLE_NOT_CONFIGURED);
    }
    if (code === undefined || code.length === 0) {
      return {
        url: this.authentication.googleFailureUrl(),
        statusCode: HttpStatus.FOUND,
      };
    }

    const result = await this.authentication.authenticateGoogleCallback(code);
    if (result.kind === 'invalid-token' || result.kind === 'not-configured') {
      return {
        url: this.authentication.googleFailureUrl(),
        statusCode: HttpStatus.FOUND,
      };
    }
    if (result.kind === 'unexpected') {
      return {
        url: this.authentication.googleFailureRedirect(),
        statusCode: HttpStatus.FOUND,
      };
    }

    response.cookie('token', result.token, this.authentication.tokenCookieOptions());
    return {
      url: `aeko://(home)?token=${result.token}`,
      statusCode: HttpStatus.FOUND,
    };
  }

  @Post('google/mobile')
  @HttpCode(HttpStatus.OK)
  public async mobile(@Body() body: unknown): Promise<Readonly<Record<string, unknown>>> {
    if (!this.authentication.isGoogleConfigured()) {
      return legacyAuthFailure(HttpStatus.SERVICE_UNAVAILABLE, GOOGLE_NOT_CONFIGURED);
    }
    const parsed = mobileGoogleSchema.safeParse(body);
    if (!parsed.success) {
      return legacyAuthFailure(HttpStatus.BAD_REQUEST, {
        success: false,
        message: 'ID token is required',
      });
    }
    const result = await this.authentication.authenticateGoogleMobile(parsed.data);
    switch (result.kind) {
      case 'authenticated':
        return {
          success: true,
          message: 'Login successful',
          token: result.token,
          deepLink: `aeko://(home)?token=${result.token}`,
          user: result.user,
        };
      case 'not-configured':
        return legacyAuthFailure(HttpStatus.SERVICE_UNAVAILABLE, GOOGLE_NOT_CONFIGURED);
      case 'invalid-token':
        return legacyAuthFailure(HttpStatus.UNAUTHORIZED, {
          success: false,
          message: 'Invalid ID token',
        });
      case 'unexpected':
        return legacyAuthFailure(HttpStatus.INTERNAL_SERVER_ERROR, {
          success: false,
          message: 'Authentication failed',
        });
    }
  }
}
