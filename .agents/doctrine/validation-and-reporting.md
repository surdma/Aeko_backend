# Validation and reporting

Runtime evidence is required.

## Minimum evidence

- relevant static checks and TypeScript build;
- Prisma schema validation and migration review when persistence changes;
- unit tests for domain and serialization behavior;
- integration tests for database/provider boundaries;
- HTTP contract tests for migrated routes;
- Socket.IO contract tests for migrated events;
- exact-value tests for money, lamports and fee allocation;
- negative authorization, privacy and replay tests;
- startup/readiness behavior when configuration or PostgreSQL is unavailable.

For migration, run equivalent behavior cases against Express and NestJS before cutover. Differences
must be intentional and documented.

## High-risk gates

A reviewer must block release for:

- exposed or unrotated credentials;
- payment accepted without durable reconciliation;
- asset payment without atomic ownership transfer;
- private content made public;
- missing ownership/authorization checks;
- unsafe `number` conversion for chain or currency values;
- database schema change without a deployable migration;
- route handled by both runtimes;
- scheduled job duplicated across runtimes;
- success reported before chain confirmation.

## Completion report

Report:

- behavior changed;
- route owner and migration state;
- contracts preserved or intentionally versioned;
- tests and commands actually run;
- database/provider/blockchain effects;
- security considerations;
- deployment, cutover and rollback status;
- remaining blockers without speculation.
