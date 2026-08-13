# Debates, Challenges and Spaces Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate all 16 active `debates-challenges-spaces` capabilities — 13 REST routes and 3 Prisma models — into strict NestJS debate, challenge, and space modules without changing successful client behavior, while correcting the missing authorization, vote integrity, and lost-update defects these three routers share.

**Architecture:** Three feature modules, each owning one lifecycle-owned Prisma boundary typed against the generated client and explicit JSON contracts. `DebatesModule` owns the debate lifecycle, AI scoring, and voting; `ChallengesModule` owns challenge creation, duets, and voting; `SpacesModule` owns live audio spaces and highlights. Every contested JSON counter is written inside a `Serializable` transaction with bounded P2034 retry, matching the pattern already established in ads, posts, comments, and status. AI scoring is reached only through a typed `DebateScoringPort` whose adapter arrives with the `chat-realtime` domain.

**Tech Stack:** NestJS 11, TypeScript strict mode, Prisma ORM 7, Zod 4, Better Auth principals/guards, Jest.

## Global Constraints

- Treat `docs/nestjs-migration/domains/debates-challenges-spaces.json` as the exact 16-capability scope and `C:/Users/olaitan/Dev/aeko/backend` as read-only behavioral evidence.
- Preserve the canonical `Debate`, `Challenge`, and `Space` tables and their JSON fields; do not execute migration SQL or connect to a real database.
- Keep native Better Auth as the only authentication implementation and the existing `SessionGuard`, `RoleGuard`, and `TwoFactorGuard` as authorization inputs.
- Keep one lifecycle-owned Prisma client; no feature may instantiate `PrismaClient` or `PrismaPg`.
- Boundaries are typed against the generated client (`src/generated/prisma/client`); the reflection style used before commit `2ad284b` is gone.
- Do not use `any`, double casts, non-null assertions, raw request objects, unbounded reads, or raw provider/database errors.
- Generate every new Nest module, controller, service, and port class with the Nest CLI and record the exact command in `docs/nestjs-migration/nest-cli-ledger.md`.
- Register every corrected defect in `corrections.json` before relying on it.
- AdminJS and all UI remain out of scope. Final whole-backend battle testing and independent review remain programme-final gates after all ten domains.

---

## Legacy defects found while reading the source

Recorded here so the tasks below are implementing against evidence, not guesses.

| #   | Route                                                  | Defect                                                                                                                                                                                                            |
| --- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `PUT /api/challenges/:challengeId/vote`                | The voter is read from **`req.body.userId`**, so any caller can cast a vote as any other user. The legacy source even comments that this is questionable.                                                         |
| 2   | `PUT /api/debates/:debateId/vote`                      | No per-voter record at all — `votes[participantId] += 1` on every call, so one user can vote without limit.                                                                                                       |
| 3   | `PUT /api/debates/:debateId/score`                     | No authorization whatsoever: any authenticated user can drive the AI scorer against any debate and overwrite a participant's score.                                                                               |
| 4   | `PUT /api/spaces/:spaceId/highlight`                   | No authorization whatsoever: any authenticated user can append highlights to anyone's space.                                                                                                                      |
| 5   | `GET /api/challenges`                                  | Includes a Challenge relation named `creator`, which does not exist on the model — the relation is `user`. Every call raises a Prisma validation error and returns 500, exactly like the posts `/reposts` defect. |
| 6   | All of `scores`, `votes`, `participants`, `highlights` | Read-modify-write of a JSON column outside any transaction; concurrent writes silently lose one another.                                                                                                          |
| 7   | Both list routes                                       | `limit` is unbounded, and participants are resolved with one user query per row.                                                                                                                                  |

Two behaviors that look like defects but are **preserved**, because clients depend on them:

- `GET /api/debates` and `GET /api/challenges` are **unauthenticated** while every other route in these routers requires a session. They are public listings; requiring auth would break anonymous clients.
- Ending an already-ended debate or challenge succeeds and rewrites `endedAt`. Only the space end route is idempotent.

---

## File Structure

- `src/debates/`, `src/challenges/`, `src/spaces/`: one slice each — contract, controller, service, Prisma boundary.
- `src/providers/debate-scoring/`: typed AI scoring port with a deferred adapter.
- `test/debates-challenges-spaces/`: focused contracts, debates, challenges, spaces, and cutover suites.
- `docs/nestjs-migration/domains/debates-challenges-spaces-owners.json`: exactly one owner for each of 16 capabilities.

### Task 1: Generate boundaries and lock exact ownership

**Files:**

- Create: `src/debates/{debates.module,debates.controller,debates.service}.ts` and the same trio for `challenges`, `spaces`
- Create: `src/providers/debate-scoring/debate-scoring.port.ts`
- Modify: `src/app.module.ts`, `docs/nestjs-migration/nest-cli-ledger.md`
- Create: `docs/nestjs-migration/domains/debates-challenges-spaces-owners.json`
- Test: `test/migration/debates-challenges-spaces-coverage.spec.ts`

**Interfaces:** Consumes the committed 16-ID manifest. Produces one owner tuple per capability and three AppModule-imported feature modules.

- [x] **Step 1: Write ownership RED**

```ts
expect(manifest.capabilityIds).toHaveLength(16);
expect(new Set(Object.keys(owners))).toEqual(new Set(manifest.capabilityIds));
expect(Object.values(owners).every((value) => value.length === 1)).toBe(true);
expect(ownerCounts).toEqual({ debates: 6, challenges: 6, spaces: 4 });
```

- [x] **Step 2: Run RED**

Expected: FAIL because the owner map and generated modules do not exist.

- [x] **Step 3: Generate exact artifacts with Nest CLI, then run GREEN**

Assign `Debate` to `debates`, `Challenge` to `challenges`, `Space` to `spaces`, and each route to the feature owning its path prefix.

### Task 2: Add strict contracts

**Files:** Create `src/debates/debate.contract.ts`, `src/challenges/challenge.contract.ts`, `src/spaces/space.contract.ts`; test `test/debates-challenges-spaces/contracts.spec.ts`.

**Interfaces:** Produces non-null `DebateView`, `DebateCreate`, `DebateScore`, `DebateVote`, `EndDecision`, `ChallengeView`, `ChallengeCreate`, `DuetEntry`, `SpaceView`, `SpaceCreate`, and `HighlightEntry` parsers plus a shared bounded list query.

- [x] **Step 1: Write contracts RED, implement, then run GREEN**

Bound every page and text field, require HTTPS media URLs for duet and highlight videos, cap participant arrays, and reject unknown mutation keys rather than stripping them. The voter is never accepted from the request body.

### Task 3: Migrate debates

**Files:** Create `src/debates/debate-prisma.client.ts`; modify the debates slice; test `test/debates-challenges-spaces/debates.spec.ts`.

**Interfaces:** Produces `start`, `score`, `vote`, `end`, and `list`.

- [x] **Step 1: Write RED, implement, then run GREEN**

Register exact routes `POST /api/debates/start`, `PUT /api/debates/:debateId/score`, `PUT /api/debates/:debateId/vote`, `PUT /api/debates/:debateId/end`, `GET /api/debates`.

Corrections: scoring requires the debate creator or an administrator; both counters are written in a `Serializable` transaction; scoring goes through `DebateScoringPort`. The list stays public and unpaged in shape but is bounded and resolves participants in one query, not one per row.

> **Revised 2026-08-10, during implementation.** This task originally promised
> "one vote per voter" for debates. That is not deliverable here, and saying so
> is better than pretending otherwise.
>
> `challenges.votes` is an array of voter ids and already dedupes, so the
> challenge fix in Task 4 is real: take the voter from the session instead of
> the body and the existing `includes` check does the rest.
>
> `debates.votes` is a counts map, `{ participantId: n }`, with no voter
> identity stored anywhere and no spare column on `Debate`. Enforcing one vote
> per voter needs somewhere to record who voted, which means either changing
> the stored shape — breaking every client that reads `votes[participantId]` as
> a number — or adding a `DebateVote` table, which is a schema migration this
> plan's constraints exclude.
>
> So Task 3 delivers the transactional increment, which fixes the lost-update
> half of the defect, and the ballot-stuffing half is registered as
> `correction:debate-vote-ballot-stuffing` with status `pending-schema`. It is
> carried the same way the social graph normalization was: a `DebateVote(voterId,
debateId, participantId)` table with a unique constraint, backfilled from the
> existing counts as anonymous votes, then a read cutover. Task 6 records it as
> an open gate rather than counting it as corrected.

### Task 4: Migrate challenges

**Files:** Create `src/challenges/challenge-prisma.client.ts`; modify the challenges slice; test `test/debates-challenges-spaces/challenges.spec.ts`.

**Interfaces:** Produces `create`, `duet`, `vote`, `end`, and `list`.

- [ ] **Step 1: Write RED, implement, then run GREEN**

Register exact routes `POST /api/challenges/create`, `PUT /api/challenges/:challengeId/duet`, `PUT /api/challenges/:challengeId/vote`, `PUT /api/challenges/:challengeId/end`, `GET /api/challenges`.

Corrections: the voter is always the authenticated principal and never `req.body.userId`; the list selects the real `user` relation instead of the non-existent `creator`, which makes the route work at all; duet and vote writes are transactional.

### Task 5: Migrate spaces

**Files:** Create `src/spaces/space-prisma.client.ts`; modify the spaces slice; test `test/debates-challenges-spaces/spaces.spec.ts`.

**Interfaces:** Produces `create`, `end`, and `addHighlight`.

- [ ] **Step 1: Write RED, implement, then run GREEN**

Register exact routes `POST /api/spaces/create`, `PATCH /api/spaces/:spaceId/end`, `PUT /api/spaces/:spaceId/highlight`.

Corrections: adding a highlight requires the host; the highlight append is transactional. Ending stays idempotent and host-only, as it already is.

### Task 6: Close the cutover unit

**Files:** Modify manifest, corrections register, coverage test; create `test/debates-challenges-spaces/cutover.spec.ts` and `docs/nestjs-migration/debates-challenges-spaces-compatibility.md`.

- [ ] **Step 1: Write cutover RED, then complete documentation and run the gates**

Assert the exact 13 routes with no additions, 16/16 closure, no Express-era patterns in any migrated service, and that no service reads a voter identity from a request body. Document the corrected defects, the preserved public list routes, and the deferred `DebateScoringPort`.

## Deferred integration gate

`PUT /api/debates/:debateId/score` calls the AI bot, whose capabilities belong to the `chat-realtime` domain (programme order 7). This plan implements the route, its authorization, contract, and persistence against a typed `DebateScoringPort`; until that domain lands, the installed adapter returns a fixed `PROVIDER_UNAVAILABLE`. Task 6 records this as an open gate rather than claiming scoring parity.

## Self-Review

- Spec coverage: all 16 IDs map to one task and one owner; no route or provider is invented.
- Security coverage: vote authenticity, scoring authorization, host-only highlights, and transactional counters are each explicitly tested.
- Type consistency: all JSON is parsed into explicit immutable contracts; no raw request object reaches a service.
- Programme boundary: AI scoring is deferred by design; whole-backend battle tests and independent review remain after all ten domains.
