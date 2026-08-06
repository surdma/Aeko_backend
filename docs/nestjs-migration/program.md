# NestJS Domain Migration Programme

## Current state

The clean NestJS operational foundation and parity tooling live on
`agent/continue-nestjs-native-foundation`. All production product capabilities remain Express-owned.
This programme begins the domain-by-domain migration without deleting or routing away from the
legacy service.

## Delivery sequence

| Order | Programme | Candidate Nest ownership | Specialist gate | Current state |
| ---: | --- | --- | --- | --- |
| 0 | Foundation, inventory, parity, CI | Platform modules | Legacy engineer and reviewer | Candidate foundation implemented; production remains Express |
| 1 | Public low-risk routes | Waitlist and public metadata modules | Legacy engineer and reviewer | Waitlist signup selected as first slice |
| 2 | Auth, users, profiles, privacy and security | Auth, users and security modules | Legacy engineer and reviewer | Planned |
| 3 | Content and communities | Content, social and community modules | Blockchain engineer where anchoring crosses domains | Planned |
| 4 | Media and external providers | Media and provider modules | Privacy and disclosure review | Planned |
| 5 | Chat, livestream and Socket.IO | Messaging and live modules | Realtime parity review | Planned |
| 6 | Payments, plans and webhooks | Billing and payments modules | Payment/replay review | Planned |
| 7 | AdminJS and operational actions | Admin and operations modules | Admin authorization review | Planned |
| 8 | Wallets, NFTs, marketplace, rewards and staking | AEKO domain modules | Blockchain engineer mandatory | Planned |
| 9 | Remaining jobs, cutovers and Express removal | Owning domains | Independent release review | Planned |

## First slice decision

`POST /api/waitlist` is the first candidate because it is public, has one PostgreSQL write, has no
authentication, media, realtime, payment or blockchain side effects, and has a small observable
contract.

The related AdminJS resource and `/admin/waitlist-export` route are not part of this slice. They
remain Express-owned until the admin programme migrates authenticated sessions, CSV export and
AdminJS operational behavior together.

## Ownership rules

- Express remains the current production owner until black-box parity passes and deployment routing
  explicitly moves.
- NestJS is only the candidate owner during this PR.
- The same production request must never be accepted by both runtimes.
- Database schema and existing waitlist rows remain unchanged.
- The Express route is retained as rollback evidence after candidate implementation.

## Review gates

1. exact method, path, normalization, status and JSON parity;
2. exact Prisma row values and unique-email behavior;
3. rate-limit parity: 100 requests per 15 minutes;
4. stable database-unavailable behavior;
5. no raw database or provider error disclosure;
6. Node 24, pnpm, strict TypeScript, Biome, Vitest, SWC and Prisma validation;
7. explicit routing and rollback evidence before any ownership change.
