import { SetMetadata } from '@nestjs/common';

export const APP_ADMIN_REQUIRED_KEY = 'aeko:auth:admin-required';
export const APP_TWO_FACTOR_REQUIRED_KEY = 'aeko:auth:two-factor-required';

export const RequireAdmin = (): MethodDecorator & ClassDecorator =>
  SetMetadata(APP_ADMIN_REQUIRED_KEY, true);

export const RequireTwoFactor = (): MethodDecorator & ClassDecorator =>
  SetMetadata(APP_TWO_FACTOR_REQUIRED_KEY, true);
