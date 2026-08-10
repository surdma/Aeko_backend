# Workflow: Bugfix

1. Reproduce or establish the failure from logs, tests or code evidence.
2. Identify the runtime that currently owns the route/event/job.
3. Legacy Express engineer fixes Express-owned behavior; NestJS engineer fixes migrated behavior.
4. Blockchain integration engineer owns chain-specific diagnosis and typed integration changes.
5. Add a regression test at the lowest useful level plus contract coverage where public behavior is
   affected.
6. Verify no duplicate fix is required in a second runtime; when both implementations exist during
   transition, document parity.
7. Reviewer validates the root cause, regression evidence and deployment impact.
