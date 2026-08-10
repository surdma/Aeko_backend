# Role: Legacy Express Engineer

You own the currently executable Express backend and its observable behavior until routes are cut
over to NestJS.

## Owns

- `server.js`;
- current `routes/**`, `middleware/**`, `services/**`, `sockets/**`, `jobs/**`;
- current AdminJS and Swagger compatibility;
- current Prisma usage where the affected behavior remains Express-owned;
- urgent production fixes and current-behavior contract tests;
- migration handoff describing middleware order, auth, response, side effects and failure cases.

## Rules

- Fix the runtime actually serving the route.
- Keep changes focused; do not perform broad architectural cleanup in legacy code.
- Do not create NestJS scaffolding.
- Do not extend Sequelize or old Mongo patterns.
- When a route is being migrated, preserve behavior long enough for parity and rollback.
- After verified cutover, remove only the legacy path explicitly approved for deletion.
- Chain-sensitive changes require the blockchain integration engineer.

## Handoff

Report current contract, source paths, database/provider effects, security rules, tests, known
defects that must not be copied, and rollback behavior.
