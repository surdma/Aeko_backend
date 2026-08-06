# NestJS Domain Migration Programme

## Current state

The clean NestJS operational foundation, parity tooling and waitlist candidate are present on
`migration/nestjs-clean`. The complete interests domain and native JWT/admin/2FA foundation are under
review in PR #4. The support-tickets domain is the next stacked candidate because it depends on that
authentication foundation and has no provider, realtime, payment or blockchain side effects.

All production product capabilities remain Express-owned. Candidate modules do not change deployment
routing or delete legacy code.

## Delivery sequence

| Order | Programme | Candidate Nest ownership | Specialist gate | Current state |
| ---: | --- | --- | --- | --- |
| 0 | Foundation, inventory, parity, CI | Platform modules | Legacy engineer and reviewer | Candidate foundation implemented; production remains Express |
| 1 | Public low-risk routes | Waitlist and public metadata modules | Legacy engineer and reviewer | Waitlist candidate implemented |
| 2 | Auth, users, profiles, privacy and security | Auth, users and security modules | Legacy engineer and reviewer | Interests/auth under review; support tickets in progress |
| 3 | Content and communities | Content, social and community modules | Blockchain engineer where anchoring crosses domains | Planned |
| 4 | Media and external providers | Media and provider modules | Privacy and disclosure review | Planned |
| 5 | Chat, livestream and Socket.IO | Messaging and live modules | Realtime parity review | Planned |
| 6 | Payments, plans and webhooks | Billing and payments modules | Payment/replay review | Planned |
| 7 | AdminJS and operational actions | Admin and operations modules | Admin authorization review | Planned |
| 8 | Wallets, NFTs, marketplace, rewards and staking | AEKO domain modules | Blockchain engineer mandatory | Planned |
| 9 | Remaining jobs, cutovers and Express removal | Owning domains | Independent release review | Planned |

## Active candidate sequence

1. Waitlist public write candidate.
2. Public interests read candidate.
3. Complete interests domain plus native JWT/admin/2FA infrastructure.
4. Complete support-tickets domain, stacked on the authentication foundation.

## Ownership rules

- Express remains the current production owner until black-box parity passes and deployment routing
  explicitly moves.
- NestJS is only the candidate owner during implementation PRs.
- The same production request must never be accepted by both runtimes.
- Existing Prisma models and rows remain unchanged unless a separately reviewed migration requires it.
- Legacy handlers remain available as rollback evidence after candidate implementation.

## Review gates

1. exact method, path, middleware, authorization, status and JSON parity;
2. exact Prisma query, ordering, transaction and durable-effect parity;
3. rate-limit parity;
4. stable user-friendly failures with no raw database or provider disclosure;
5. Node 24, pnpm, strict TypeScript, Biome, Vitest, SWC and Prisma validation;
6. explicit routing and rollback evidence before any ownership change;
7. independent reviewer Pass before merge or cutover.
