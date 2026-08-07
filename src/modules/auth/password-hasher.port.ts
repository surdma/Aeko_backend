export interface PasswordHasher {
  hash(value: string, rounds?: number): Promise<string>;
  compare(value: string, hash: string): Promise<boolean>;
}

export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');
