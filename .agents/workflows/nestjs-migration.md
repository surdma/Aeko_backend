# Workflow: NestJS migration

1. Planner selects one bounded route family or Socket.IO capability.
2. Legacy Express engineer produces a behavior handoff: routes/events, middleware order, auth,
   contracts, Prisma effects, providers, jobs, errors and known unsafe behavior.
3. Reviewer or planner confirms acceptance criteria and defects that must be corrected rather than
   copied.
4. NestJS backend engineer implements the vertical slice under `src/**`.
5. Blockchain integration engineer participates when the slice touches AEKO RPC/explorer or
   on-chain state.
6. Run the same contract cases against Express and NestJS.
7. Update route ownership, deployment routing and rollback evidence.
8. Cut over one owner.
9. Reviewer validates parity, security, migration and rollback.
10. Remove the legacy path only in a later explicit cleanup after stable cutover.

No big-bang rewrite and no empty domain scaffolding.
