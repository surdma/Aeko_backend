# Aeko database compatibility

## Scope

The NestJS target preserves the complete Aeko domain schema and uses one canonical Prisma `User` mapped to the existing `users` table. Better Auth is the only target authentication implementation. Its credentials, provider accounts, sessions, verifications, and two-factor secrets use `Account`, `Session`, `Verification`, and `TwoFactor`; bearer authentication adds no table.

The legacy `users.password`, `users.oauthId`, `users.oauthProvider`, `users.emailVerification`, and `users.twoFactorAuth` columns are not present in the target Prisma model and must not be read or written by target auth code. The reviewed SQL keeps these physical columns and makes only `password` nullable so native Better Auth user creation is compatible. It does not copy legacy hashes or OAuth data into Better Auth storage.

## Migration safety

`20260808_add_better_auth_compatibility` is review-only in this task. It adds Better Auth user columns, creates the official-name auth/plugin tables and indexes, and attaches cascading foreign keys to `users.id`. It contains no table/column drop, rename, truncate, credential backfill, or data rewrite and has not been executed against a database.

## Better Auth schema provenance

The installed auth runtime is Better Auth 1.6.26 and the official CLI package used for generation is 1.4.21. The CLI output is preserved unedited at `prisma/better-auth.generated.prisma` with SHA-256 `521D97AEE1640295F5A8CA2EF19E6925EF7BE618D3E960052BDD00359C12E1EC`. It generated `User`, `Session`, `Account`, `Verification`, and plugin model `TwoFactor`; bearer added no table. The merged canonical `User` retains `@@map("users")` and all Aeko domain relations while using the generated Better Auth field nullability and relation names.
