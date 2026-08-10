# Content and social compatibility

Scope: the 52 `content-social` capabilities — 46 REST routes and 6 Prisma
models. AdminJS and all UI remain out of scope.

## Closure

**49 of 52 implemented.** Three post routes are deliberately outstanding:
`POST /api/posts/:postId/anchor`, `POST /api/posts/:postId/mint-as-nft`, and
`GET /api/posts/:postId/verify`. They depend on the `aeko-chain` and `ipfs`
providers owned by the `chain` domain (programme order 9) and land with it
through the already-declared `ContentChainPort`. The manifest records
`implemented-except-chain`, not `implemented`.

## Changes clients must know about

These follow from approved corrections in `corrections.json`.

1. **Two post routes now work that never did.** `GET /api/posts/mixed` and
   `GET /api/posts/videos` were declared after `GET /:postId` in Express, so
   every request resolved to the single-post handler and 404'd. Both are live.
2. **`GET /api/posts/:postId/reposts` now works.** It included a Post relation
   named `user`, which does not exist on the model, so it returned 500 on every
   call. Same defect fixed on `/mixed`, `/videos`, and the privacy update.
3. **Private posts are no longer readable by id.** The single-post read checked
   blocking but never privacy. A denied read returns `404`, not `403`, so an id
   cannot be probed for existence.
4. **A private post's comment thread is no longer readable or writable** by
   anyone holding the post id.
5. **Sharing a post to a status requires visibility.** Legacy carried an
   explicit "allow sharing" comment and no access check.
6. **Every list endpoint is bounded.** Comment threads, replies, the status
   feed, and the report queue were unbounded. Responses keep their existing
   shape — a bare array stays a bare array — but accept `page` and `limit`.
7. **Moderation requires an auditable reason.** `warn` and `ban` reject a
   request with no reason instead of substituting a generic string, and both
   require an administrator with a confirmed two-factor session.
8. **Notification settings are validated.** `PUT /api/notifications/settings`
   persisted the raw request body; it now accepts only the documented nested
   shape.

## Behavior deliberately preserved

Some legacy behavior looks like a defect but is what clients depend on, so it
is unchanged:

- **Liking a comment is idempotent, not a toggle.** There is no unlike route; a
  repeat call returns the unchanged comment with `isLiked: true`.
- **An expired status still accepts a reaction.** Only `reshare` gates on
  expiry.
- **Repeat status reactions from the same user are appended**, not deduplicated.
- **Deleting a status reports missing and not-owned identically**, so it cannot
  be used to probe for ids.
- **`GET /api/status` returns every visible active status**, not only those from
  people you follow, despite what the legacy Swagger comment claims. The
  implementation is the contract.
- **Explore keeps its exclusion split**: trending and viral still include people
  you follow; only the discovery sections exclude them.

## Realtime notification delivery (addition)

`GET /api/notifications/stream` and `GET /api/notifications/realtime-health` are
**additions**, not migrated capabilities. The eight REST notification routes are
unchanged, so a client that never opens the stream behaves exactly as today.

- **Transport.** With `REDIS_URL`, notifications fan out across every instance
  over Redis pub/sub, one channel per recipient. Without it, an in-process bus
  serves subscribers on that instance — realtime still works on a single
  instance rather than being switched off. `realtime-health` reports which
  guarantee is in force.
- **Producers.** The legacy Express service writes notifications straight to
  Postgres and never publishes. A relay tails the table and publishes anything
  this service did not, so the stream does not miss legacy-written
  notifications. With Redis the relay is a BullMQ repeatable job so the scan
  runs once per cluster; without Redis it is a plain interval, which is correct
  for a single instance. When Express is retired the relay can be deleted and
  delivery becomes pure push.
- **Failures.** A broker outage never fails the write that produced the
  notification. Publishing reports `undelivered`, the relay holds its watermark
  at the first failure, and every held notification is retried until it lands.
  Degradation is logged once per outage and visible on `realtime-health`.
- **Restarts.** The relay starts one grace window (60s) behind, so
  notifications written while the process was down are still delivered.
- **Client note.** `EventSource` cannot send an `Authorization` header, so
  bearer-token clients cannot use the stream; cookie-session browser clients
  can. Bearer clients keep polling `GET /api/notifications` unchanged.

## Dual-write window

Post likes, comment likes, blocks, follows, and not-interested are written to
both the legacy JSON columns and the new relational tables. Reads still use the
JSON columns, per Plan C step 3. Nothing here reads the relational tables yet;
that is Plan C step 4, gated on the Express service being retired.
