import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
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
import {
  APP_CONFIGURATION,
  type AppConfiguration,
} from '../../config/configuration.js';
import {
  GOOGLE_NOT_CONFIGURED,
  googleFailureRedirect,
  legacyAuthFailure,
  tokenCookieOptions,
} from './authentication-http.js';
import { mobileGoogleSchema } from './authentication.schemas.js';
import { GoogleAuthenticationService } from './google-authentication.service.js';

@Controller('api/auth')
@UseGuards(ThrottlerGuard)
@UseFilters(LegacyApiThrottlerExceptionFilter)
export class GoogleAuthenticationController {
  public constructor(
    private readonly googleAuthentication: GoogleAuthenticationService,
    @Inject(APP_CONFIGURATION)
    private readonly configuration: AppConfiguration,
  ) {}

  @Get('google')
  @Redirect()
  public google(): HttpRedirectResponse {
    const url = this.googleAuthentication.authorizationUrl();
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
    const failureUrl = this.configuration.auth.google.failureRedirect;
    if (!this.googleAuthentication.isConfigured()) {
      legacyAuthFailure(HttpStatus.SERVICE_UNAVAILABLE, GOOGLE_NOT_CONFIGURED);
    }
    if (code === undefined || code.length === 0) {
      return { url: failureUrl, statusCode: HttpStatus.FOUND };
    }

    const result = await this.googleAuthentication.callback(code);
    if (result.kind === 'invalid-token' || result.kind === 'not-configured') {
      return { url: failureUrl, statusCode: HttpStatus.FOUND };
    }
    if (result.kind === 'unexpected') {
      return {
        url: googleFailureRedirect(failureUrl),
        statusCode: HttpStatus.FOUND,
      };
    }

    response.cookie(
      'token',
      result.token,
      tokenCookieOptions(this.configuration.app.environment === 'production'),
    );
    return {
      url: `aeko://(home)?token=${result.token}`,
      statusCode: HttpStatus.FOUND,
    };
  }

  @Post('google/mobile')
  @HttpCode(HttpStatus.OK)
  public async mobile(
    @Body() body: unknown,
  ): Promise<Readonly<Record<string, unknown>>> {
    if (!this.googleAuthentication.isConfigured()) {
      return legacyAuthFailure(
        HttpStatus.SERVICE_UNAVAILABLE,
        GOOGLE_NOT_CONFIGURED,
      );
    }
    const parsed = mobileGoogleSchema.safeParse(body);
    if (!parsed.success) {
      return legacyAuthFailure(HttpStatus.BAD_REQUEST, {
        success: false,
        message: 'ID token is required',
      });
    }
    const result = await this.googleAuthentication.mobile(parsed.data);
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
        return legacyAuthFailure(
          HttpStatus.SERVICE_UNAVAILABLE,
          GOOGLE_NOT_CONFIGURED,
        );
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
