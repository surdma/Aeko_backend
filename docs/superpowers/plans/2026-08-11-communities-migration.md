# Communities migration

Domain 6 of the Express → NestJS migration. Twenty-three capabilities: four
models and nineteen routes across communities, community profiles and community
payments. Risk is high — this domain owns paid memberships and withdrawals.

Depends on `auth-users-security`, `content-social` and `payments-subscriptions`,
all migrated. Settlement of a paid membership already landed with domain 5 as
`PrismaCommunityPaymentAdapter`; this domain adds initialisation, verification,
withdrawal and the transaction history around it.

## Route surface to preserve

| Route | Auth | Legacy source |
| --- | --- | --- |
| `POST /api/communities` | session + 2FA | `communityRoutes.js:70` |
| `GET /api/communities` | public | `communityRoutes.js:114` |
| `GET /api/communities/my` | session | `communityRoutes.js:116` |
| `GET /api/communities/:id` | session | `communityRoutes.js:146` |
| `POST /api/communities/:id/join` | session | `communityRoutes.js:178` |
| `POST /api/communities/:id/leave` | session | `communityRoutes.js:206` |
| `PUT /api/communities/:id` | owner/moderator | `communityRoutes.js:256` |
| `DELETE /api/communities/:id` | owner + 2FA | `communityRoutes.js:299` |
| `PUT /api/community-profiles/:id/profile` | owner/moderator | `communityProfileRoutes.js:72` |
| `POST /api/community-profiles/:id/upload-photo` | owner/moderator | `communityProfileRoutes.js:128` |
| `PUT /api/community-profiles/:id/settings` | owner only | `communityProfileRoutes.js:199` |
| `POST /api/community-profiles/:id/follow` | session | `communityProfileRoutes.js:248` |
| `POST /api/community-profiles/:id/unfollow` | session | `communityProfileRoutes.js:280` |
| `POST /api/community-profiles/:id/posts` | member/follower | `communityProfileRoutes.js:329` |
| `GET /api/community-profiles/:id/posts` | session | `communityProfileRoutes.js:384` |
| `POST /api/community/payment/initialize` | session | `communityPaymentRoutes.js:63` |
| `GET /api/community/payment/verify` | public | `communityPaymentRoutes.js:133` |
| `POST /api/community/payment/withdraw` | owner + 2FA | `communityPaymentRoutes.js:224` |
| `GET /api/community/payment/:communityId/transactions` | owner | `communityPaymentRoutes.js:366` |

`GET /api/community/payment/verify` stays public: it is the provider callback.

## The central problem: membership is stored twice

Legacy keeps community membership in **two unrelated places**:

- the relational `CommunityMember` table, written by `joinCommunity`,
  `leaveCommunity` and `deleteCommunity`, and read by `getCommunity`,
  `updateCommunity`'s moderator check, the follow guard and the post guard;
- the JSON `Community.members` array plus `User.communities`, written by
  `handleCommunityPaymentSuccess` — the paid path — and read by nothing in the
  request surface.

So a member who **paid** is invisible to every relational read. Concretely, in
legacy today: a paid member does not appear in `GET /api/communities/:id`, is
not counted as a member by `POST /api/community-profiles/:id/posts`, can be
told "you are not a member" by `leave`, and can be sold the same membership
again by `join`, which only checks `CommunityMember`.

That is not a subtlety — it is the paid feature failing to grant what was paid
for, on every route except the one that wrote the JSON.

**Decision: dual-write, relational-authoritative-on-read.** Settlement writes
the relational `CommunityMember` row *as well as* the JSON it writes today.
Reads stay on the relational table, which is what every route already uses, so
no read path changes shape. The JSON keeps being written so that anything
outside this migration still reading it — AdminJS, reports — keeps working, and
so a rollback to legacy Express loses nothing. This mirrors the Plan C
dual-write already used for the social graph.

A backfill for memberships that were paid for before the cutover is a separate,
explicitly-scoped migration script, since it needs production data to be
meaningful. It is listed as a task and must not be silently skipped.

## Legacy defects found while reading the source

| # | Where | Defect | Disposition |
| --- | --- | --- | --- |
| 1 | `communityController.js` settlement split | A paid membership is written only to JSON, so every relational read treats the payer as a non-member. | correct — dual-write the relational row at settlement |
| 2 | `communityController.js:23` | `user.goldenTick` is read off a possibly-missing row, so a deleted user answers 500. | correct — report the missing user |
| 3 | `communityController.js:112` | The listing builds `OR: [name contains search, description contains search, tags has search]` unconditionally; with no search term this still runs three predicates per row. | correct — omit the filter when no term is given |
| 4 | `communityController.js` join | `memberCount` is incremented outside any check that the member row was newly created; a racing double join can double-count. | correct — increment inside the transaction that creates the row, keyed on the unique constraint |
| 5 | `communityController.js` delete | Deleting removes every `CommunityMember` row but leaves `memberCount` at its old value, so a reactivated community reports phantom members. | correct — zero the count with the deletion |
| 6 | `communityController.js` update | `if (name)` / `if (tags)` skip falsy-but-valid updates and the settings merge is a read-modify-write outside a transaction. | correct — explicit presence checks, merge inside a transaction |
| 7 | Every controller | 500 responses include `error.message` when `NODE_ENV=development`. | correct — the `DomainError` filter withholds internals |
| 8 | `communityPaymentRoutes.js` | Withdrawal validates the amount against earnings read outside the transaction that decrements them. | correct — validate and reserve in one `Serializable` transaction |

Deliberately **not** changed:

- Only golden-tick users may create a community.
- A private community's join creates a `pending` row and returns 200, rather
  than a 202 or a 403.
- A paid community answers `402` with the price attached.
- The owner cannot leave their own community.
- Delete is a soft delete that flips `isActive` and clears the member rows.

## Tasks

1. Nest CLI scaffolding for `communities`, `community-profiles` and
   `community-payments`; ledger entries; owners map for the 23 capabilities.
2. Contracts: create/update, list and search queries, join/leave, profile and
   settings updates, payment initialisation, withdrawal and the transaction
   query.
3. Prisma boundaries for `Community`, `CommunityMember`, `CommunityFollower`
   and the community `Transaction` view.
4. Communities slice — create, list, my, get, join, leave, update, delete.
   Closes defects 2–7.
5. Community profiles slice — profile, photo, settings, follow, unfollow,
   posts. The photo upload reuses the media provider port from ads/media.
6. Community payments slice — initialise, verify, withdraw, transactions.
   Closes defect 8 and consumes the settlement adapter from domain 5 rather
   than duplicating it.
7. **Membership dual-write.** Extend `PrismaCommunityPaymentAdapter` to write
   the relational `CommunityMember` row alongside the JSON, with tests proving
   a paid member is visible to `getCommunity`, `leave`, `join` and the post
   guard. Closes defect 1.
8. Backfill script for memberships paid before the cutover, with a dry-run
   mode and a determinism test, mirroring the social-graph backfill.
9. Cutover — route-set assertion with no additions, 23/23 closure, corrections
   registered, compatibility document.

Same rule as the previous five domains: failing test first, implement, then run
the domain suite, `tsc` and ESLint before moving on.
