import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { LegacyApiThrottlerExceptionFilter } from '../../common/legacy-api-throttler-exception.filter.js';
import { legacyAuthFailure } from './authentication-http.js';
import { LegacyAuthBodyPipe } from './legacy-auth-body.pipe.js';
import {
  forgotPasswordSchema,
  resetPasswordSchema,
  type ForgotPasswordInput,
  type ResetPasswordInput,
} from './authentication.schemas.js';
import { PasswordRecoveryService } from './password-recovery.service.js';

@Controller('api/auth')
@UseGuards(ThrottlerGuard)
@UseFilters(LegacyApiThrottlerExceptionFilter)
export class PasswordRecoveryController {
  public constructor(private readonly recovery: PasswordRecoveryService) {}

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  public async forgotPassword(
    @Body(
      new LegacyAuthBodyPipe(forgotPasswordSchema, {
        success: false,
        error: 'Email is required',
      }),
    )
    input: ForgotPasswordInput,
  ): Promise<Readonly<Record<string, unknown>>> {
    const result = await this.recovery.forgotPassword(input);
    switch (result.kind) {
      case 'accepted':
        return {
          success: true,
          message:
            'If an account with that email exists, a password reset link has been sent.',
        };
      case 'timed-out':
        return legacyAuthFailure(HttpStatus.GATEWAY_TIMEOUT, {
          success: false,
          error: 'Email sending timed out. Please try again later.',
        });
      case 'unexpected':
        return legacyAuthFailure(HttpStatus.INTERNAL_SERVER_ERROR, {
          success: false,
          message: 'Failed to process request',
        });
    }
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  public async resetPassword(
    @Body(
      new LegacyAuthBodyPipe(resetPasswordSchema, {
        success: false,
        error: 'Token and new password are required',
      }),
    )
    input: ResetPasswordInput,
  ): Promise<Readonly<Record<string, unknown>>> {
    const result = await this.recovery.resetPassword(input);
    switch (result.kind) {
      case 'reset':
        return {
          success: true,
          message: 'Password has been reset successfully',
        };
      case 'invalid-token':
        return legacyAuthFailure(HttpStatus.BAD_REQUEST, {
          success: false,
          error: 'Invalid or expired token',
        });
      case 'user-not-found':
        return legacyAuthFailure(HttpStatus.NOT_FOUND, {
          success: false,
          error: 'User not found',
        });
      case 'unexpected':
        return legacyAuthFailure(HttpStatus.INTERNAL_SERVER_ERROR, {
          success: false,
          message: 'Failed to reset password',
        });
    }
  }
}
