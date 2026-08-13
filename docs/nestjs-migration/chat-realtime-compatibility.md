# Chat realtime compatibility and cutover record

Domain 7 contains 102 capabilities: 34 REST routes, 58 root-namespace
Socket.IO capabilities, six data models, and four provider capabilities. The
domain manifest assigns every capability to exactly one Nest owner. The entire
unit changes owner together; Express and Nest must never both accept chat writes.

## Preserved contracts

- The REST paths, verbs, successful status codes, request fields, and success
  response projections remain those captured in
  `test/chat-realtime/fixtures/legacy-rest.json`.
- The root Socket.IO namespace, inbound event names, outbound event names,
  acknowledgement views, and message payload projections remain those captured
  in `test/chat-realtime/fixtures/legacy-socket-events.json`.
- Existing clients may omit `clientMessageId`; Nest generates one in that
  compatibility case. Clients that send one receive idempotent retry behavior
  scoped to their chat.
- Reconnect recovery reads durable messages by server-assigned per-chat
  sequence. Redis Pub/Sub is fan-out only, never history.

## Approved intentional failure differences

The nine approved `correction:chat-*` records in the correction ledger replace
unsafe legacy behavior: cross-replica delivery, room and message authorization,
call signalling authorization, bounded media, provider-safe errors, distributed
rate limiting, idempotent retries, durable outbox delivery, and unread
reconciliation. These changes preserve successful client contracts while
returning stable rejection codes instead of unauthorized relay, raw internal
error, duplicate-write, or unbounded-resource behavior.

## Dependency and degradation mode

Postgres remains authoritative for messages, membership, ordering, unread
state, and outbox rows. Redis supplies Socket.IO fan-out, presence, short-lived
caches, and distributed rate-limit coordination. If Redis is unavailable,
durable operations continue only where their authorization and correctness do
not depend on the degraded feature; health reports degraded fan-out/presence.
BullMQ processes outbox side effects. If it is unavailable, committed outbox
rows remain pending and catch up after recovery; an acknowledged message is not
discarded. AI, push, and media providers are isolated behind safe error mapping;
media upload fails before a message can reference a missing attachment.

## Upload migration

Multipart upload is the supported path. Attachments are membership-authorized,
size-bounded, filename-sanitized, validated by declared MIME type and magic
bytes, and stored through the provider port. The temporary base64 socket
adapter accepts only a strict data URL capped at 1 MiB; it does not write local
files and remains removable after client-usage telemetry confirms retirement.

## Cutover and rollback procedure

1. Apply the additive, idempotent `prisma/data-migrations/chat-realtime-cutover.sql`
   migration and verify the existing message identities, bodies, and timestamps.
2. Confirm the complete 102-capability manifest, owner map, contract suite,
   two-replica Redis proof, degradation/backpressure suites, and review gates.
3. Switch the complete chat-realtime route, Socket.IO namespace, provider, and
   worker traffic owner to Nest in one routing change; disable Express handling
   for the same unit before accepting Nest writes.
4. Observe acknowledgement failures, outbox age, queue lag, Redis adapter
   health, and reconnect recovery. Roll back by switching the same complete
   owner set to Express and stopping Nest write handling. Do not reverse the
   additive data migration: legacy rows and columns remain compatible.

The two-replica Redis fan-out and backpressure proofs passed 2/2 in the focused
suite. The benchmark report remains an open release gate: both
`LEGACY_CHAT_BENCHMARK_URL` and `NEST_CHAT_BENCHMARK_URL` are currently absent,
so no latency, throughput, or regression result is recorded here.
