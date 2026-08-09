# Native Aeko authentication cutover

## Endpoint ownership

Better Auth is the only owner of `/api/auth/**`. The native Node handler is mounted before Express JSON and URL-encoded parsers so Better Auth receives the original request. Nest does not implement an auth compatibility controller, JWT verifier, bcrypt password flow, Passport callback, verification-code store, reset-token store, or token-cookie adapter.

## Legacy removal map

| Removed Express behavior                                                | Native Better Auth replacement                                      | Client change                                                                                                                                         |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/signup` with bcrypt and a legacy response envelope      | `POST /api/auth/sign-up/email`                                      | Send Better Auth's native sign-up body and consume its native response. When no typed email port is installed, sign-up is deliberately disabled.      |
| `POST /api/auth/login` with JWT creation and handwritten 2FA middleware | `POST /api/auth/sign-in/email` plus the two-factor plugin           | Treat `twoFactorRedirect: true` as incomplete authentication. Complete TOTP/backup-code verification before requesting a session.                     |
| `POST /api/auth/verify-email`                                           | `GET /api/auth/verify-email`                                        | Follow the Better Auth verification URL delivered by the Aeko email port. Do not submit a legacy verification-code payload.                           |
| `POST /api/auth/resend-verification`                                    | `POST /api/auth/send-verification-email`                            | Use the native request and response contract.                                                                                                         |
| `GET /api/auth/me`                                                      | `GET /api/auth/get-session`                                         | Read `user` and `session`; do not expect a legacy `{ token, user }` envelope.                                                                         |
| `POST /api/auth/logout`                                                 | `POST /api/auth/sign-out`                                           | Let Better Auth clear its session cookie; bearer clients discard the returned/held bearer token.                                                      |
| `POST /api/auth/forgot-password`                                        | `POST /api/auth/request-password-reset`                             | Submit the native email and absolute redirect URL. Responses do not disclose whether the account exists.                                              |
| `POST /api/auth/reset-password` with an application reset token         | `POST /api/auth/reset-password`                                     | Submit Better Auth's native token contract. A successful reset revokes sessions.                                                                      |
| Passport `GET /api/auth/google` and callback handlers                   | `POST /api/auth/sign-in/social` and `GET /api/auth/callback/google` | Send `provider: "google"`; use the native redirect/callback flow. Google exists only when both validated credentials are configured.                  |
| `POST /api/auth/google/mobile` token exchange                           | Native Google social sign-in flow                                   | Mobile clients use Better Auth's supported social flow; the handwritten mobile payload and JWT response are removed.                                  |
| `GET /api/auth/profile-completion`                                      | No auth-protocol replacement                                        | This is application profile data and moves to a later user/profile slice; clients must not call it as an auth endpoint.                               |
| `PUT /api/profile/change-password`                                      | `POST /api/auth/change-password`                                    | Use Better Auth's native current/new password contract. Nest profile routes never read, hash, or compare passwords.                                   |
| `DELETE /api/profile/delete-account`                                    | `POST /api/auth/delete-user`                                        | Use Better Auth's native authenticated self-delete flow. The native delete-user capability is explicitly enabled.                                     |
| Direct profile email mutation                                           | `POST /api/auth/change-email`                                       | Email change is enabled only when the verified email delivery port is installed; `PUT /api/profile/update` rejects `email`.                           |
| JWT/auth middleware, admin JWT login, and role checks                   | Better Auth cookie or bearer session plus typed Nest guards         | Protected Nest routes receive only an immutable `AuthenticatedPrincipal`. Admin access uses `isAdmin`; resource routes use explicit ownership guards. |
| Handwritten auth/admin token cookies                                    | Better Auth host-only session cookies                               | Browser clients send credentials and accept Better Auth `Set-Cookie`; they must not read or manufacture token cookies.                                |

## Security decisions

- CSRF and origin checks remain enabled. Only validated `BETTER_AUTH_TRUSTED_ORIGINS` are trusted.
- Production cookies are secure, HTTP-only, same-site lax, and host-only.
- Password hashing is Better Auth native; Aeko provides no custom hash or verifier.
- A pending two-factor challenge has no authenticated session and cannot create an `AuthenticatedPrincipal`.
- Email verification and password-reset URLs pass only through the typed `AuthEmailPort`. Provider failures become a fixed safe error; tokens, OTPs, backup codes, and token-bearing URLs are never logged.
- Without an installed email port, credential sign-up is disabled and email verification is not falsely required. Existing credential sign-in remains native.
- Password reset enables `revokeSessionsOnPasswordReset`.
- Native self-deletion is enabled. Native email change is enabled only when verification delivery callbacks are configured.
- Profile eligibility accepts absent follower JSON as zero, but malformed persisted follower data fails safely instead of silently producing a false eligibility result.

## Client cutover

Browser clients should use Better Auth session cookies with `credentials: "include"`. Non-browser API clients may use the native bearer plugin and send `Authorization: Bearer <session-token>`; they must store and transport that token as a secret. All clients must switch to native Better Auth endpoint names, request bodies, response bodies, error shapes, redirects, and `Set-Cookie` behavior before the Express auth owner is removed from deployment.
