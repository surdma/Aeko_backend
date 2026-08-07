import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module.js';
import { AuthV1Module } from '../../modules/auth-v1/auth-v1.module.js';
import { AuthV0Module } from '../../modules/auth/auth.module.js';
import { AppAuthGuard } from './app-auth.guard.js';

@Global()
@Module({
  imports: [AuthV1Module, AuthV0Module, PrismaModule],
  providers: [
    AppAuthGuard,
    { provide: APP_GUARD, useExisting: AppAuthGuard },
  ],
})
export class AppAuthenticationModule {}
