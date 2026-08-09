import { Module } from '@nestjs/common';
import { AuthRuntimeService } from './auth-runtime.service';
import { OptionalSessionGuard } from './guards/optional-session/optional-session.guard';
import { OwnershipGuard } from './guards/ownership/ownership.guard';
import { RoleGuard } from './guards/role/role.guard';
import { SessionGuard } from './guards/session/session.guard';
import { TwoFactorGuard } from './guards/two-factor/two-factor.guard';

@Module({
  providers: [
    AuthRuntimeService,
    SessionGuard,
    OptionalSessionGuard,
    RoleGuard,
    OwnershipGuard,
    TwoFactorGuard,
  ],
  exports: [
    AuthRuntimeService,
    SessionGuard,
    OptionalSessionGuard,
    RoleGuard,
    OwnershipGuard,
    TwoFactorGuard,
  ],
})
export class AuthModule {}
