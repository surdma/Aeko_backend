# NestJS migration

The approved strategy is a strangler migration, not a rewrite.

## Foundation

- Use a supported Node.js runtime for the selected NestJS major version.
- Begin with Nest's Express adapter; do not combine migration with a Fastify switch.
- Use TypeScript.
- Keep Prisma/PostgreSQL.
- Use runtime-schema-first Zod contracts and avoid duplicated class-validator models.
- Keep the repository's package manager and lockfile unless a separate task changes them.
- Validate configuration before opening the listening socket.
- Add graceful shutdown, request IDs, structured logging, Swagger and health/readiness probes.

## Route ownership

Maintain one authoritative route owner. Once migration implementation begins, create or update a
route-ownership record under `docs/nestjs-migration/` containing:

- method and path or Socket.IO event;
- current owner: Express or NestJS;
- auth and middleware requirements;
- contract-test status;
- cutover and rollback state.

Never run write handling for the same route in both runtimes.

## A migrated vertical slice includes

1. captured current behavior and consumers;
2. request/response/event schemas;
3. authorization and privacy rules;
4. application service;
5. Prisma/provider integration;
6. stable public errors;
7. unit and integration/contract tests;
8. deployment routing and rollback decision;
9. removal of old code only after verified cutover.

## Module choice

Use bounded domains such as auth, users, posts, feed, moderation, communities, messaging, live,
notifications, billing, wallet, NFT, marketplace, rewards, staking, media, support or waitlist.
Merge duplicated `enhanced` and legacy variants when behavior is understood; do not reproduce
parallel implementations in NestJS.

New features should prefer NestJS after the foundation exists, unless they depend on an unmigrated
Express-only subsystem and a compatibility implementation is safer. Document the decision.
