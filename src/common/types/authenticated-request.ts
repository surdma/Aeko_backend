import type { Request } from 'express';
import type { AppAuthenticatedUser } from '../authentication/app-authenticated-user.js';

export interface AuthenticatedRequest extends Request {
  user?: AppAuthenticatedUser;
  userId?: string;
  twoFactorVerified?: boolean;
}
