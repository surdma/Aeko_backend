# Debates, Challenges and Spaces — client compatibility

Domain 4 of the Express → NestJS migration. Thirteen routes, sixteen
capabilities, all closed. Every legacy path, verb, request field and success
response shape is preserved; the differences below are limited to defects that
could not be carried across verbatim.

## Route surface

| Route | Auth | Notes |
| --- | --- | --- |
| `POST /api/debates/start` | session | unchanged |
| `PUT /api/debates/:debateId/score` | session | creator or admin only (was: any user) |
| `PUT /api/debates/:debateId/vote` | session | unchanged shape; now transactional |
| `PUT /api/debates/:debateId/end` | session | unchanged |
| `GET /api/debates` | public | unchanged; one participant query per page |
| `POST /api/challenges/create` | session | unchanged |
| `PUT /api/challenges/:challengeId/duet` | session | now transactional |
| `PUT /api/challenges/:challengeId/vote` | session | voter is the session, not the body |
| `PUT /api/challenges/:challengeId/end` | session | creator or admin only |
| `GET /api/challenges` | public | previously returned 500 on every call |
| `POST /api/spaces/create` | session | unchanged |
| `PATCH /api/spaces/:spaceId/end` | session | host only; idempotent |
| `PUT /api/spaces/:spaceId/highlight` | session | host only (was: any user) |

No routes were added and none were removed. `test/debates-challenges-spaces/cutover.spec.ts`
asserts this set exactly, so a future addition fails the build.

## Corrected defects

1. **`correction:debate-scoring-authorization`** — scoring accepted any
   authenticated caller. It is now creator-or-admin.
2. **`correction:challenge-vote-voter-from-body`** — the voter came from
   `req.body.userId`, allowing a caller to vote as anyone and to bypass the
   one-vote dedupe. The voter is now always the session principal. The body
   field is still accepted and ignored, so existing clients keep working.
3. **`correction:space-highlight-authorization`** — highlights had no
   authorization at all. They are now host-only, matching the end route.
   Administrators are deliberately not exempt: a space is host-owned content.
4. **`correction:challenge-list-missing-relation`** — the listing included a
   `creator` relation that does not exist on the model, so Prisma raised a
   validation error and the route returned 500 every time. It now includes the
   real `user` relation and projects it as `creator`, which is the shape the
   route always documented.
5. **`correction:debate-counter-lost-updates`** /
   **`correction:challenge-space-lost-updates`** — debate votes, challenge
   duets and votes, and space highlights were read-modify-writes on JSON
   columns outside any transaction, so concurrent requests dropped each other's
   entries. Each now runs in a `Serializable` transaction with a bounded retry
   on `P2034`, and surfaces a retryable `CONFLICT` instead of losing the write.
6. **`correction:debate-list-n-plus-one`** — the debate listing resolved
   participants one query per debate. It now resolves a page with a single
   query.

## Carried forward, not corrected

**`correction:debate-vote-ballot-stuffing`** (`status: pending-schema`). A
debate's `votes` column is a counts map keyed by participant with no record of
who voted, so a user can still vote repeatedly. Closing it needs a
`DebateVote(voterId, debateId, participantId)` table with a unique constraint —
a schema migration outside this domain. Changing the stored shape instead would
break every client that reads `votes[participantId]` as a number. The
lost-update half of the defect is fixed; this half stays open and visible.

## Client-visible behaviour to be aware of

- Clients that relied on scoring or ending someone else's debate/challenge, or
  on adding highlights to someone else's space, now receive `403`. No legitimate
  client does this.
- Clients still sending `userId` on a challenge vote are unaffected; the field
  is ignored rather than rejected.
- `GET /api/challenges` starts returning `200` with data where it previously
  returned `500`. Clients with error-path fallbacks for this route can drop
  them.
- Under contention a write may return `409 CONFLICT` and is safe to retry.
