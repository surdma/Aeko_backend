# Communities — client compatibility

Domain 6 of the Express → NestJS migration. Nineteen routes, twenty-three
capabilities, all closed, with no correction left deferred. Every legacy path,
verb, request field and success response shape is preserved.

This domain was the least functional in legacy of any migrated so far: **seven
of its nineteen routes returned an error on every single call**, and the paid
membership feature granted nothing that any other route could see.

## Route surface

| Route                                                  | Auth            | Notes                                  |
| ------------------------------------------------------ | --------------- | -------------------------------------- |
| `POST /api/communities`                                | session + 2FA   | golden tick still required             |
| `GET /api/communities`                                 | public          | filter dropped when no search term     |
| `GET /api/communities/my`                              | session         | unchanged                              |
| `GET /api/communities/:id`                             | session         | unchanged                              |
| `POST /api/communities/:id/join`                       | session         | count no longer double-increments      |
| `POST /api/communities/:id/leave`                      | session         | unchanged                              |
| `PUT /api/communities/:id`                             | owner/moderator | settings merge now transactional       |
| `DELETE /api/communities/:id`                          | owner + 2FA     | now zeroes `memberCount`               |
| `PUT /api/community-profiles/:id/profile`              | owner/moderator | previously 500 on every call           |
| `POST /api/community-profiles/:id/upload-photo`        | owner/moderator | previously 500 on every call           |
| `PUT /api/community-profiles/:id/settings`             | owner only      | unchanged                              |
| `POST /api/community-profiles/:id/follow`              | session         | unchanged                              |
| `POST /api/community-profiles/:id/unfollow`            | session         | still idempotent                       |
| `POST /api/community-profiles/:id/posts`               | member/follower | previously 500 on every call           |
| `GET /api/community-profiles/:id/posts`                | session         | previously 500 on every call           |
| `POST /api/community/payment/initialize`               | session         | previously 400 on every call           |
| `GET /api/community/payment/verify`                    | public          | now settles through the shared adapter |
| `POST /api/community/payment/withdraw`                 | owner + 2FA     | previously 400 on every call           |
| `GET /api/community/payment/:communityId/transactions` | owner           | previously 400 on every call           |

No routes were added and none were removed; `test/communities/cutover.spec.ts`
pins the set exactly.

## The membership split

**`correction:community-membership-split`** is the defect that shaped this
domain. Legacy stored community membership in two unrelated places:

- the relational `community_members` table, written by join/leave/delete and
  read by **every** request path — the community detail, the moderator check,
  the leave check, the join check and the post guard;
- the `communities.members` JSON array, written **only** by paid settlement and
  read by nothing in the request surface.

A member who paid was therefore invisible to every relational read. They were
absent from the community detail, refused by the post guard, told "you are not
a member" if they tried to leave, and could be sold the same membership again
by join. The paid feature failed to grant what was paid for on every route
except the one that recorded the payment.

**The fix is a dual-write with relational reads.** Settlement writes both
halves; the relational row is authoritative and decides whether `memberCount`
moves, so a renewal does not inflate it and a lapsed member is reactivated
rather than duplicated. The JSON keeps being written so anything outside this
migration still reading it keeps working, and a rollback to legacy Express
loses nothing.

That repairs a JSON-only membership the next time that member pays. For the
ones who never pay again, the **cutover backfill** inserts the missing
relational rows and resets the drifted `memberCount`. It is tested against a
real Postgres through PGlite with the shapes the column actually holds — a null
`members`, an object where an array belongs, a bare string among the entries,
and an entry naming a deleted user. An existing relational row always wins, so
the backfill never downgrades a role the table already holds.

Run it during cutover:

```bash
psql "$DATABASE_URL" -f prisma/data-migrations/legacy-cutover.sql
```

## Always-failing routes repaired

- **`correction:community-profile-missing-relation`** — the profile and photo
  routes resolved the caller's membership through `include: { memberships }`.
  There is no `memberships` relation on `Community` in either schema; it is
  `community_members`. Prisma rejected the query, so both answered 500 every
  time.
- **`correction:community-post-missing-relations`** — both post routes included
  `user` and `community` on `Post`. Neither is a relation name there; they are
  `users_posts_userIdTouser` and `communities`. Both answered 500 every time.
- **`correction:community-payment-mongoid-validation`** — all three community
  payment routes validated the community id with `isMongoId()`. Community ids
  are UUIDs, and a 36-character UUID can never satisfy a 24-hex-character
  check, so every real community was rejected with 400.
- **`correction:community-stripe-verify-reference`** — Stripe initialisation
  never persisted the PaymentIntent id, and verification then asked Stripe to
  resolve the `COMM-…` reference, which is not a Stripe id.

## Concurrency and counter corrections

- **`correction:community-join-double-count`** — join created the membership
  and incremented the count with no gate on whether the row was new. The unique
  constraint now decides, inside a `Serializable` transaction.
- **`correction:community-delete-member-count`** — deleting cleared every
  membership row but left `memberCount` untouched, so a reactivated community
  reported members that no longer existed.
- **`correction:community-settings-merge-race`** — the settings merge read
  outside the update that overwrote it, losing one of two concurrent changes.
- **`correction:community-withdrawal-balance-race`** — the available balance
  was validated outside the write that reserves against it, so two withdrawals
  racing each other could overdraw a community's earnings.
- **`correction:community-golden-tick-missing-user`** — the golden tick was
  read off a possibly-missing user row.
- **`correction:community-listing-empty-search`** — the search term defaulted
  to an empty string, so the listing ran two case-insensitive `contains` scans
  against every row even with no term. Page size was also unbounded; it is now
  capped at 100.

## Preserved deliberately, not corrected

- Only golden-tick users may create a community.
- Joining a private community creates a `pending` row and answers `200` with
  `requiresApproval`, rather than a 202 or a 403.
- A paid community answers `402` with the price attached, so the client can
  render its paywall.
- The community owner cannot leave their own community.
- Delete is a soft delete that flips `isActive` and clears the member rows.
- The optional `amount` on payment initialisation is accepted and ignored; the
  price always comes from the community's own settings.
- The active-subscription check reads the JSON members array, because that is
  where the subscription term lives — the relational row has no such column.

## Client-visible deltas to be aware of

- The seven routes listed above start returning success where they previously
  always failed. Clients carrying error-path fallbacks for them can drop those.
- The `402` body now carries `requiresPayment` and `paymentInfo` under
  `details`, inside the standard error envelope every migrated domain uses,
  rather than at the top level.
- A community's `memberCount` will change once when the backfill runs, to match
  the membership it is supposed to count.
- Under contention a write may return `409 CONFLICT` and is safe to retry.
