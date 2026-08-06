import type { Request } from 'express';
import type { AuthenticatedUser } from '../../modules/auth/auth.types.js';

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
  userId?: string;
  twoFactorVerified?: boolean;
}
