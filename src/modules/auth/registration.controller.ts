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
import { AuthenticationService } from './authentication.service.js';
import { legacyAuthFailure } from './authentication-http.js';
import { LegacyAuthBodyPipe } from './legacy-auth-body.pipe.js';
import {
  resendVerificationSchema,
  signupSchema,
  verifyEmailSchema,
  type ResendVerificationInput,
  type SignupInput,
  type VerifyEmailInput,
} from './authentication.schemas.js';

@Controller('api/auth')
@UseGuards(ThrottlerGuard)
@UseFilters(LegacyApiThrottlerExceptionFilter)
export class RegistrationController {
  public constructor(private readonly authentication: AuthenticationService) {}

  @Post('signup')
  public async signup(
    @Body(
      new LegacyAuthBodyPipe(signupSchema, {
        success: false,
        message: 'All fields are required',
      }),
    )
    input: SignupInput,
  ): Promise<Readonly<Record<string, unknown>>> {
    if (input.password.length < 6) {
      return legacyAuthFailure(HttpStatus.BAD_REQUEST, {
        success: false,
        message: 'Password must be at least 6 characters long',
      });
    }

    const result = await this.authentication.signup(input);
    switch (result.kind) {
      case 'created':
        return {
          success: true,
          message: result.emailSent
            ? 'Registration successful! Check your email for verification code'
            : `Registration successful! Email service unavailable. Your verification code is: ${result.verificationCode}`,
          userId: result.userId,
          emailSent: result.emailSent,
          ...(result.emailSent ? {} : { verificationCode: result.verificationCode }),
        };
      case 'duplicate-email':
        return legacyAuthFailure(HttpStatus.CONFLICT, {
          success: false,
          message: 'Email already registered',
        });
      case 'duplicate-username':
        return legacyAuthFailure(HttpStatus.CONFLICT, {
          success: false,
          message: 'Username already taken',
        });
      case 'unexpected':
        return legacyAuthFailure(HttpStatus.INTERNAL_SERVER_ERROR, {
          success: false,
          message: 'Registration failed',
        });
    }
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  public async verifyEmail(
    @Body(
      new LegacyAuthBodyPipe(verifyEmailSchema, {
        success: false,
        message: 'User ID and verification code are required',
      }),
    )
    input: VerifyEmailInput,
  ): Promise<Readonly<Record<string, unknown>>> {
    const result = await this.authentication.verifyEmail(input);
    switch (result.kind) {
      case 'verified':
        return {
          success: true,
          message: 'Email verified successfully! Welcome to Aeko!',
          token: result.token,
          deepLink: `aeko://(home)?token=${result.token}`,
          user: result.user,
        };
      case 'user-not-found':
        return legacyAuthFailure(HttpStatus.NOT_FOUND, {
          success: false,
          message: 'User not found',
        });
      case 'already-verified':
        return legacyAuthFailure(HttpStatus.BAD_REQUEST, {
          success: false,
          message: 'Email already verified',
        });
      case 'missing-code':
        return legacyAuthFailure(HttpStatus.BAD_REQUEST, {
          success: false,
          message: 'No verification code found',
        });
      case 'expired-code':
        return legacyAuthFailure(HttpStatus.BAD_REQUEST, {
          success: false,
          message: 'Verification code has expired',
        });
      case 'too-many-attempts':
        return legacyAuthFailure(HttpStatus.BAD_REQUEST, {
          success: false,
          message: 'Too many failed attempts. Please request a new code',
        });
      case 'invalid-code':
        return legacyAuthFailure(HttpStatus.BAD_REQUEST, {
          success: false,
          message: 'Invalid verification code',
        });
      case 'unexpected':
        return legacyAuthFailure(HttpStatus.INTERNAL_SERVER_ERROR, {
          success: false,
          message: 'Email verification failed',
        });
    }
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  public async resendVerification(
    @Body(
      new LegacyAuthBodyPipe(resendVerificationSchema, {
        success: false,
        message: 'User ID is required',
      }),
    )
    input: ResendVerificationInput,
  ): Promise<Readonly<Record<string, unknown>>> {
    const result = await this.authentication.resendVerification(input.userId);
    switch (result.kind) {
      case 'sent':
        return {
          success: true,
          message: result.emailSent
            ? 'New verification code sent to your email'
            : `Email service unavailable. Your new verification code is: ${result.verificationCode}`,
          emailSent: result.emailSent,
          ...(result.emailSent ? {} : { verificationCode: result.verificationCode }),
        };
      case 'user-not-found':
        return legacyAuthFailure(HttpStatus.NOT_FOUND, {
          success: false,
          message: 'User not found',
        });
      case 'already-verified':
        return legacyAuthFailure(HttpStatus.BAD_REQUEST, {
          success: false,
          message: 'Email already verified',
        });
      case 'rate-limited':
        return legacyAuthFailure(HttpStatus.TOO_MANY_REQUESTS, {
          success: false,
          message: 'Please wait 1 minute before requesting a new code',
        });
      case 'unexpected':
        return legacyAuthFailure(HttpStatus.INTERNAL_SERVER_ERROR, {
          success: false,
          message: 'Failed to resend verification code',
        });
    }
  }
}
