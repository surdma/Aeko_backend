# Chat and Realtime NestJS Migration Design

## Purpose

Migrate Domain 7, `chat-realtime`, from the legacy Express runtime into the
NestJS modular monolith while preserving observable client behavior and
rebuilding the internal implementation for horizontal scale, durable delivery,
security, maintainability, and predictable failure recovery.

This domain owns exactly 102 active capabilities: six Prisma models, four
provider capabilities, 34 REST routes, and 58 Socket.IO capabilities. It follows
the six completed domains and precedes `livestream`, which depends on the
realtime foundation established here.

The legacy implementation is behavioral evidence, not an architectural
template. Existing successful REST responses, Socket.IO event names, outbound
payloads, acknowledgements, and ordering remain the compatibility floor.
Internal components, persistence boundaries, transport adapters, caches, queues,
and provider integrations are replaced with explicit NestJS feature boundaries.

## Scope

The complete scope is the cutover unit in
`docs/nestjs-migration/domains/chat-realtime.json`:

- models: `BotConversation`, `BotSettings`, `Chat`, `ChatMember`,
  `EnhancedMessage`, and `Message`;
- REST: all 34 `/api/chat`, `/api/enhanced-chat`, `/api/bot`, and
  `/api/enhanced-bot` capabilities in the manifest;
- realtime: all 58 inbound and outbound root-namespace Socket.IO capabilities,
  including chat, presence, reactions, receipts, voice activity, and video-call
  signalling;
- providers: the three AI capabilities and push-notification capability in the
  manifest.

The domain does not carry audio or video media through NestJS, Socket.IO, Redis,
or BullMQ. Video-call events are WebRTC signalling only. Livestream behavior
remains Domain 8 and is not implemented here.

## Architectural Decision

Use a transport-independent NestJS application core with a Socket.IO
compatibility edge, REST and multipart HTTP endpoints, Redis-backed realtime
coordination, a transactional outbox, and BullMQ workers.

Socket.IO remains the interactive wire protocol because existing clients use
its events, rooms, reconnection, and acknowledgement semantics. Replacing it
with raw WebSockets would create a client flag day and require rebuilding
already-solved protocol behavior. SSE remains limited to one-way notification
delivery; it is not a substitute for bidirectional chat, receipts, reactions,
typing, or signalling.

The same application commands and queries serve REST, Socket.IO, and future
transport adapters. No business rule is implemented in a controller, gateway,
queue processor, or provider adapter.

## Feature Boundaries

### Realtime infrastructure

Owns the Nest Socket.IO adapter, Redis connections, Better Auth handshake,
connection lifecycle, presence leases, rate limiting, room conventions,
cross-replica broadcasting, health reporting, and graceful shutdown.

### Chat

Owns conversation creation, membership, group administration, messages,
server-assigned per-chat ordering, replies, edits, deletion, reactions, read
receipts, search, history, and unread reconciliation.

### Chat media

Owns multipart parsing, file validation, provider-backed storage, attachment
metadata, attachment authorization, and the temporary bounded adapter for legacy
base64 voice/file payloads.

### Video calls

Owns authenticated and authorized WebRTC offer, answer, and ICE signalling.
Peers may signal only when the authenticated principal is permitted to interact
with the target through an existing chat. Client-supplied socket or user IDs do
not establish identity or authorization.

### Bot

Owns bot settings, conversations, personalities, ratings, summaries, image
generation, usage policy, and provider-neutral AI ports. Provider latency and
failure cannot block or degrade human-to-human chat.

### Chat delivery

Owns the transactional outbox, BullMQ producers and workers, retry policy,
deduplication, push notifications, provider side effects, dead-letter recovery,
and reconciliation.

### Chat compatibility

Owns exact REST response serializers, Socket.IO inbound translators, outbound
event views, acknowledgement views, and stable public error mapping. Internal
domain events never become public payloads directly.

## Request and Event Flow

For every durable message command:

1. Authenticate the Better Auth session and derive the principal on the server.
2. Parse the transport payload with a strict Zod contract and enforce bounded
   payload depth and size.
3. Apply per-user, per-IP, per-chat, and event-specific rate limits.
4. Authorize chat membership, target message access, and recipient eligibility.
5. Persist the message and its outbox event atomically in Postgres.
6. Return the legacy-compatible acknowledgement from the persisted record.
7. Publish the public event through the Socket.IO Redis adapter to every Nest
   replica.
8. Let BullMQ workers process push, AI, media post-processing, moderation, and
   other retryable secondary effects.

A successful acknowledgement means the message is durable. If Postgres is not
available, the server emits no success acknowledgement.

## Delivery Semantics

- Internal work is at-least-once.
- Message creation is effectively once when the client supplies
  `(chatId, clientMessageId)`.
- New clients must send `clientMessageId`; it is optional at the compatibility
  boundary for existing clients, where the server generates one. A generated
  identifier cannot deduplicate a retry made by an unmodified legacy client.
- Every accepted message receives a server-assigned monotonic sequence within
  its chat. Ordering does not rely on timestamps alone.
- Duplicate fan-out is safe because clients and adapters can deduplicate by the
  durable message ID.
- Reconnect recovery reads durable history from Postgres by sequence cursor;
  Redis Pub/Sub is never treated as history.
- An offline recipient retrieves persisted messages on reconnect. Push
  notification is a secondary BullMQ effect, not message durability.

The implementation must document the chosen Postgres mechanism for allocating
per-chat sequences and prove concurrent writers cannot receive the same
sequence or reorder committed messages.

## State Ownership and Caching

Postgres is authoritative for chats, membership, messages, receipts, reactions,
bot settings, provider usage records, the outbox, and durable delivery state.

Redis contains only ephemeral or derived state:

- Socket.IO cross-replica fan-out;
- presence and heartbeat leases;
- typing and recording indicators;
- distributed rate-limit buckets;
- short-lived membership authorization caches;
- short-lived unread-count caches;
- bounded idempotency and duplicate-suppression windows.

All keys are namespaced, have an explicit owner and TTL where applicable, and
have documented invalidation rules. Membership mutations invalidate affected
authorization keys immediately. Unread caches are reconciled from Postgres and
are never the only copy of unread state.

Redis infrastructure is trusted internal infrastructure and must use private
networking, authentication, encryption in transit where supported, ACLs, and
dedicated least-privilege credentials. Socket adapter, application cache, and
queue roles use separate credentials when deployment infrastructure supports
that separation.

## Queues and Transactional Outbox

The message write and outbox record occur in one database transaction. BullMQ
workers consume claimed outbox work idempotently. The design does not publish a
queue job inside a database transaction and assume both operations succeeded.

BullMQ handles only deferred or retryable effects:

- offline push notifications;
- AI replies, summaries, analysis, and image generation;
- media post-processing, scanning, and moderation hooks;
- provider retries;
- unread, presence, and outbox reconciliation;
- dead-letter inspection and controlled replay.

Each job has a stable business idempotency key, bounded attempts, exponential
backoff with jitter, a timeout, a concurrency limit, and an explicit terminal
failure disposition. Job payloads contain identifiers and required metadata,
not raw private message bodies or media unless the worker cannot perform its
owned function without them.

## Media

Multipart HTTP upload is the supported media path. It performs streaming or
bounded-memory ingestion, byte-based MIME inspection, independent extension
validation, size limits by media class, sanitized metadata, provider-backed
storage, and authorization-aware retrieval. Private attachments use short-lived
signed access or an authenticated proxy according to the existing media port.

The upload completes before a chat message references the resulting media
record. Provider failure cannot create a message pointing to nonexistent media.

Legacy base64 voice/file socket payloads remain temporarily accepted through a
strictly size-limited compatibility adapter that passes bytes into the same
media service. It does not write local container files. Its usage is metered,
documented as deprecated, and removable only after client telemetry proves it is
unused. Socket frame limits are reduced from the legacy 100 MB allowance to a
documented production limit that supports compatibility without permitting
unbounded memory pressure.

## Compatibility Contract

The migration preserves:

- the 34 REST paths, verbs, authentication requirements, successful statuses,
  and successful response bodies;
- all inbound Socket.IO event names and every legacy field still required from
  those payloads;
- all outbound Socket.IO event names and their payload shapes;
- acknowledgement behavior where legacy clients depend on it;
- message ordering and reconnect-visible history;
- the root namespace required by existing clients.

Security and correctness defects may intentionally change failure behavior.
Every intentional difference is registered in
`docs/nestjs-migration/corrections.json`, linked to executable evidence, and
described in the domain compatibility document.

New optional fields are additive. Internal event envelopes are versioned but
never exposed as replacements for public client payloads. There is no mixed
Express/Nest writer phase: the complete 102-capability cutover unit changes
runtime ownership together.

## Security

- Better Auth is the sole connection and request identity authority.
- Client-supplied user IDs are data, never identity.
- Every event naming a chat, message, recipient, member, or peer performs
  resource authorization.
- Membership removal revokes room access and invalidates authorization caches.
- Socket and HTTP origins use the configured allowlist; wildcard CORS is not
  permitted.
- Public errors use stable codes and safe messages. Raw Prisma, Redis, BullMQ,
  media, AI, or provider exceptions never reach clients.
- Uploads enforce MIME, size, and metadata policy and expose scanning and
  moderation hooks.
- Logs and metrics exclude credentials, session material, message bodies, raw
  media, signed URLs, and provider secrets.
- Privileged membership, deletion, moderation, upload rejection, and bot-setting
  changes create audit records.

## Backpressure and Resource Control

Durable message commands receive priority over ephemeral events. The system
uses bounded socket frames, per-principal connection limits, event-specific
token buckets, bounded queue concurrency, provider bulkheads, database query
limits, upload limits, timeouts, and circuit-breaker or load-shedding policy.

Under pressure, typing, recording, and high-frequency presence refreshes may be
dropped or coalesced before durable message acceptance is rejected. Search and
history use bounded pagination. No handler performs unbounded collection reads,
fan-out loops, file buffering, or synchronous provider work.

## Failure and Recovery

- Redis unavailable: durable operations continue only when their authorization
  and correctness do not depend on unavailable ephemeral state. Cross-replica
  fan-out, presence, typing, rate-limit coordination, and caches report degraded
  health. The service never claims horizontally correct realtime delivery while
  the adapter is unavailable.
- BullMQ unavailable: message transactions continue; outbox rows remain pending
  and workers catch up after recovery.
- AI or push provider unavailable: human chat remains operational; provider work
  retries or terminates with a stable provider-unavailable result.
- Media provider unavailable: the upload fails before message creation.
- Database unavailable: durable commands fail and emit no success
  acknowledgement.
- Replica termination: graceful shutdown stops new connections and work claims,
  drains bounded in-flight work, and releases resources. Abrupt termination is
  covered by presence lease expiry, reconnect recovery, and durable outbox work.

Readiness distinguishes required dependencies from degraded optional
capabilities. Health output exposes the active realtime adapter, queue state,
outbox age, and degradation without revealing credentials.

## Observability

Structured logs, metrics, and traces carry request, socket, principal, chat,
message, outbox, and job correlation identifiers where safe. Required metrics
include:

- active and peak connections per replica;
- connection, authentication, reconnect, and disconnect rates;
- inbound event rate and rejection rate by stable code;
- message persistence and acknowledgement latency;
- local and cross-replica fan-out latency;
- Redis command errors and adapter health;
- queue depth, lag, attempts, terminal failures, and oldest pending outbox age;
- upload throughput, validation rejection, and provider latency;
- AI and push provider latency and failure;
- duplicate suppression and idempotency conflicts;
- unread reconciliation drift;
- authorization and rate-limit rejection counts.

Alerts use service-level symptoms such as acknowledgement latency, failed
durable commands, outbox age, queue lag, and cross-replica delivery failure,
not process uptime alone.

## Verification and Performance Gates

Executable evidence must prove:

1. All 102 manifest IDs have exactly one Nest owner and the cutover closes all
   102 with nothing silently skipped.
2. Fixtures cover every successful REST contract and every inbound/outbound
   Socket.IO capability, including duplicate declarations in the inventory.
3. Intentional corrections are registered and tested.
4. Two application replicas exchange room and direct events through Redis.
5. Retrying after a dropped acknowledgement creates one message when
   `clientMessageId` is supplied.
6. Concurrent message writers produce unique, stable per-chat ordering.
7. Disconnect and reconnect recover missed durable messages in order.
8. Redis, BullMQ, worker, provider, and replica failures recover without loss of
   any acknowledged message.
9. Unauthorized room access, message mutation, membership operations, uploads,
   and call signalling are rejected.
10. Multipart limits, content validation, provider failure, and the bounded
    legacy-media adapter are exercised.
11. Domain tests, migration tests, TypeScript, ESLint at zero warnings, Prisma
    validation, and the Nest build pass.
12. The compatibility document and independent backend, security, and realtime
    reviews return Pass before cutover.

The benchmark harness runs equivalent seeded workloads against legacy and Nest
on equivalent hardware. It records p50, p95, and p99 acknowledgement latency,
fan-out latency, reconnect recovery time, sustained messages per second, error
rate, CPU, memory, database load, Redis load, and queue lag. Exact numeric
budgets are established from the captured legacy baseline before implementation
is accepted; Nest must meet or improve that baseline, or document and obtain
approval for a measured regression. Multi-replica correctness is mandatory even
where legacy cannot provide it.

## Cutover and Rollback

The complete chat-realtime domain changes runtime ownership atomically. Express
and Nest do not write chat state concurrently. Existing schema-compatible data
is preserved; any required backfill is idempotent, rehearsed against
legacy-shaped data, and verified before cutover.

Rollback switches the entire traffic owner back to Express without reversing
compatible durable data. New additive fields and tables remain safe for the
legacy runtime. The cutover and rollback harness proves route ownership, socket
ownership, provider ownership, queue ownership, and absence of dual writers.

## Completion Definition

Domain 7 is complete only when all 102 capabilities are closed by executable
evidence; compatibility and approved corrections are documented; durable
delivery, ordering, idempotency, two-replica fan-out, degradation, recovery,
security, and performance gates pass; the complete programme gates remain
green; and independent backend, security, and realtime review returns Pass.
