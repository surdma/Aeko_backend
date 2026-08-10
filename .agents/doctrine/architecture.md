# Architecture

## Current repository

The active runtime is the root Express application:

- `server.js` composes middleware, routes, Socket.IO, Swagger, jobs and AdminJS;
- `routes/**` contains transport and substantial business logic;
- `services/**`, `middleware/**`, `sockets/**`, `jobs/**` and `chain/**` provide supporting behavior;
- `prisma/schema.prisma` defines application persistence;
- Sequelize and older migration residue may exist but must not be extended.

## Target

Because Aeko Backend is already a standalone backend repository, the NestJS target is:

```text
src/
  main.ts
  app.module.ts
  config/
  common/
    decorators/
    filters/
    guards/
    interceptors/
    pipes/
    types/
  infrastructure/
    prisma/
    blockchain/
    explorer/
    storage/
    email/
    payments/
    observability/
  modules/
    <bounded-domain>/
  workers/
```

This structure is a taxonomy, not a command to create every directory. Create only the vertical
slice being migrated.

## Dependency direction

```text
controller or gateway
  -> application/domain service
  -> repository or typed infrastructure port
  -> Prisma / RPC / explorer / external provider
```

Controllers and gateways must not read environment variables, construct raw chain instructions,
perform Prisma queries, or call payment/media providers directly.

## Boundaries

- `src/modules/**` owns product behavior.
- `src/infrastructure/**` owns provider-specific transport and decoding.
- `src/common/**` contains genuinely cross-cutting Nest concerns, not generic dumping grounds.
- Do not create `apps/api/**`; that layout solves a monorepo problem this repository does not have.
- Do not introduce microservices, CQRS, event sourcing, Kafka or repository-per-model patterns
  without a demonstrated requirement.
- AdminJS may remain on Express until late migration.
