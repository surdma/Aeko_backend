# Conventions

## Target NestJS code

- Use TypeScript strictness appropriate to production backend code.
- Use intent-revealing domain names; avoid `utils`, `helpers`, `manager`, `data`, `processThing` and
  generic service names when a specific name exists.
- Keep controllers and gateways thin.
- Keep provider details out of domain services.
- Split files when they mix unrelated responsibilities, not to satisfy arbitrary line limits.
- Avoid broad barrel exports that create hidden cycles.
- Prefer explicit constructor injection.
- Avoid static service containers and direct `process.env` access outside configuration.
- Do not create one file per trivial type or an interface for every class.

A feature may use:

```text
<domain>.module.ts
<domain>.controller.ts
<domain>.service.ts
dto/
schemas/
repositories/     only when meaningful
policies/         only when meaningful
```

## Legacy Express code

Make the smallest safe change required to preserve production behavior. Do not reorganize the whole
legacy application during an unrelated fix. New long-lived abstractions belong in NestJS unless the
legacy runtime needs them for compatibility.

## Hygiene

- Use the existing package manager and lockfile.
- Remove dead imports and obsolete duplicated code only with behavior evidence.
- Keep commits and PRs focused.
- Comments explain constraints and intent, not obvious syntax.
