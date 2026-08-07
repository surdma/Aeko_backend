export interface AppAuthenticatedUser {
  readonly id: string;
  readonly username: string;
  readonly email: string;
  readonly name: string;
  readonly isAdmin: boolean;
  readonly banned: false;
  readonly twoFactorEnabled: boolean;
  readonly twoFactorStatus: Readonly<{ isEnabled: boolean }>;
  readonly partialLogin?: true;
}
