import { Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import type { PasswordHasher } from '../../modules/auth/password-hasher.port.js';

@Injectable()
export class BcryptPasswordHasher implements PasswordHasher {
  public hash(value: string, rounds = 10): Promise<string> {
    return bcrypt.hash(value, rounds);
  }

  public compare(value: string, hash: string): Promise<boolean> {
    return bcrypt.compare(value, hash);
  }
}
