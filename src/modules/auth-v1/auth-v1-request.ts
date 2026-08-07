import type { Request } from 'express';
import type { AuthV1Session } from './better-auth-v1.service.js';

export interface AuthV1Request extends Request {
  authV1?: AuthV1Session;
}
