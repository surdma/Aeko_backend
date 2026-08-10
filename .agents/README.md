# Aeko Backend agent system

`.agents/**` is the single source of truth for engineering agents in this backend repository.
`AGENTS.md`, `.claude/agents/**`, and `.codex/agents/**` are thin entry points.

## Design decisions

1. **Backend only.** No frontend, UI, mobile or design-system agents.
2. **Current behavior is evidence.** Express remains authoritative for a route until cutover.
3. **NestJS migration is active but incremental.** Migrate complete vertical slices through a
   strangler workflow; do not rewrite the whole backend.
4. **Aeko is not Laitstyles.** This standalone repository targets `src/**`, not `apps/api/**`.
5. **One owner per route.** Express and NestJS must never process writes for the same route in the
   same environment.
6. **Blockchain correctness is a first-class boundary.** Payment without asset transfer, unsafe
   number conversion, missing confirmation, or private content exposure are release blockers.
7. **Doctrine owns standards; roles own work; workflows own sequencing.**
8. **No architecture theatre.** Add modules, queues, repositories, or abstractions only when a
   migrated feature requires them.

## Current seam

```text
Frontend/client
  -> Express REST API and Socket.IO
  -> Prisma
  -> PostgreSQL

Media and metadata
  -> Cloudinary / Pinata / IPFS

Fiat flows
  -> Paystack / Stripe / Flutterwave
  -> verified webhook
  -> idempotent PostgreSQL transition

On-chain flow
  -> backend prepares unsigned transaction
  -> user wallet signs
  -> AEKO RPC submits/confirms
  -> backend reconciles PostgreSQL
  -> explorer indexes chain history
```

## Target seam

```text
api.aeko.social
  -> route ownership gateway
     -> legacy Express route, or
     -> NestJS `src/modules/<domain>`

NestJS feature module
  -> application service
  -> Prisma and/or typed infrastructure adapter
  -> PostgreSQL / AEKO RPC / explorer / provider
```

The target is a modular monolith. Empty future modules are not created in advance.

## Doctrine

| File | Owns |
| --- | --- |
| [00-authority](doctrine/00-authority.md) | Precedence, evidence and truthful status. |
| [product-and-domain](doctrine/product-and-domain.md) | Aeko Social data ownership and domain truth. |
| [architecture](doctrine/architecture.md) | Current and target boundaries and dependency direction. |
| [nestjs-migration](doctrine/nestjs-migration.md) | Strangler migration, route ownership and cutover. |
| [contracts-and-api](doctrine/contracts-and-api.md) | HTTP/socket contracts, Zod and errors. |
| [persistence](doctrine/persistence.md) | Prisma, PostgreSQL, migrations, concurrency and numeric safety. |
| [authentication-and-security](doctrine/authentication-and-security.md) | Identity, authorization, privacy and secret handling. |
| [blockchain](doctrine/blockchain.md) | AEKO RPC/explorer, transactions and reconciliation. |
| [integrations-and-operations](doctrine/integrations-and-operations.md) | Payments, media, webhooks, realtime, jobs and observability. |
| [conventions](doctrine/conventions.md) | TypeScript, naming, files and change hygiene. |
| [validation-and-reporting](doctrine/validation-and-reporting.md) | Tests, behavioral proof and completion gates. |

## Roles

Tests belong to the engineer changing behavior. The reviewer evaluates evidence and does not become
a second implementer.

## Editing this system

- Stable rules belong in doctrine.
- Source ownership and professional behavior belong in roles.
- Sequencing and handoff barriers belong in workflows.
- Keep callers thin.
- Do not record temporary debt inventories as permanent doctrine.
