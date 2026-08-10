# Authority and evidence

Apply instructions in this order:

1. platform, safety and tool constraints;
2. the user's explicit request for the current task;
3. `AGENTS.md` and `.agents/**`;
4. accepted task criteria and active migration decisions;
5. verified repository code, configuration, database schema, tests and runtime evidence;
6. current official dependency documentation;
7. general engineering knowledge.

## Truth rules

- Express is the current runtime for a route until verified cutover.
- NestJS is the approved target, not permission to claim unimplemented behavior.
- A directory, route name, Swagger comment, guide or roadmap is not proof that a feature works.
- Do not preserve a known security or asset-loss defect merely for parity. Preserve the public
  contract while correcting unsafe internals, or explicitly version the contract.
- Never expose secrets, private keys, tokens, raw provider payloads or personal data in reports.
- Treat committed credentials as compromised and require rotation, not only deletion.
- Report partial completion and blockers precisely. Do not claim tests, deployment or migration
  steps that were not executed.
