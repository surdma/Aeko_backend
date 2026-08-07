# NestJS Domain Migration Programme

## Current state

The clean NestJS/SWC operational foundation, dual-runtime parity tooling and first domain candidates live on the `migration/nestjs-clean` continuation branches. Express remains the production owner until each complete route family passes black-box and side-effect parity and receives an explicit cutover.

## Delivery sequence

| Order | Programme | Candidate Nest ownership | Specialist gate | Current state |
| ---: | --- | --- | --- | --- |
| 0 | Foundation, inventory, parity, CI | Platform modules | Legacy engineer and reviewer | Candidate foundation implemented; production remains Express |
| 1 | Public low-risk routes | Waitlist and public metadata modules | Legacy engineer and reviewer | Waitlist and complete interests candidates implemented |
| 2 | Auth, users, profiles, privacy and security | Auth, users and security modules | Legacy engineer and reviewer | Complete authentication route family implemented as a stacked candidate; users, profiles and security routes remain planned |
| 3 | Content and communities | Content, social and community modules | Blockchain engineer where anchoring crosses domains | Planned |
| 4 | Media and external providers | Media and provider modules | Privacy and disclosure review | Planned |
| 5 | Chat, livestream and Socket.IO | Messaging and live modules | Realtime parity review | Planned |
| 6 | Payments, plans and webhooks | Billing and payments modules | Payment/replay review | Planned |
| 7 | AdminJS and operational actions | Admin and operations modules | Admin authorization review | Planned |
| 8 | Wallets, NFTs, marketplace, rewards and staking | AEKO domain modules | Blockchain engineer mandatory | Planned |
| 9 | Remaining jobs, cutovers and Express removal | Owning domains | Independent release review | Planned |

## Active authentication slice

The complete `/api/auth/**` route family is the current programme-2 candidate. It includes credential registration, verification, resend, password login, login 2FA, Google web/mobile OAuth, authenticated account reads, logout and password recovery. It reuses the native JWT/admin/TOTP foundation introduced with the interests domain.

The slice replaces Passport route handling with `google-auth-library`, moves bcrypt and ZeptoMail behind typed Nest providers and retains all legacy route paths and public response contracts. Express remains authoritative until the complete family passes disposable-database parity.

## Ownership rules

- Express remains the current production owner until black-box parity passes and deployment routing explicitly moves.
- NestJS is only the candidate owner during implementation PRs.
- The same production request must never be accepted by both runtimes.
- Existing PostgreSQL schema and production data remain unchanged unless a separately reviewed schema migration is required.
- The Express implementation is retained as rollback evidence until the final programme removes it.

## Review gates

1. complete mounted endpoint and Socket.IO/job inventory for the active domain;
2. exact method, path, normalization, status, header, cookie and JSON parity;
3. exact Prisma row and JSON side effects, including failure paths;
4. provider behavior parity with timeouts, retries and replay considerations where relevant;
5. stable, user-friendly errors with no raw database, token, password or provider disclosure;
6. Node 24, pnpm, strict TypeScript, Biome lint, Vitest, SWC and Prisma validation;
7. explicit routing, observability and rollback evidence before any ownership change;
8. reviewer Pass and specialist Pass for payment, realtime or blockchain boundaries.
