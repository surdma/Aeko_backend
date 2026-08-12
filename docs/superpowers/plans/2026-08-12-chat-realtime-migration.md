# Chat and Realtime Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate all 102 `chat-realtime` capabilities into a horizontally scalable NestJS chat system while preserving legacy REST and Socket.IO behavior and proving durable, secure, ordered delivery.

**Architecture:** Thin REST and Socket.IO compatibility adapters call transport-independent chat, bot, media, call, and delivery services. Postgres owns durable state and a transactional outbox; Redis owns ephemeral presence, rate limits, caches, and cross-replica Socket.IO fan-out; BullMQ performs idempotent secondary effects. Existing clients retain their paths, event names, acknowledgements, and successful payloads while corrected security failures use stable domain errors.

**Tech Stack:** Node.js 24, TypeScript 5.7 strict mode, NestJS 11, Prisma 7/PostgreSQL, Socket.IO 4, `@socket.io/redis-adapter`, ioredis 6, BullMQ 6, Zod 4, Better Auth, Jest 30, PGlite, autocannon, and the existing media/provider ports.

## Global Constraints

- Treat `docs/nestjs-migration/domains/chat-realtime.json` as the exact 102-capability scope and `C:/Users/olaitan/Dev/aeko/backend` as read-only behavioral evidence.
- Preserve all 34 REST paths and successful response bodies, all inbound and outbound Socket.IO names and payload shapes, acknowledgement behavior, root namespace behavior, and reconnect-visible ordering.
- Better Auth is the sole identity authority. Never trust `userId`, `senderId`, `receiverId`, `chatId`, socket ID, or room name as authorization evidence.
- A success acknowledgement is emitted only after Postgres commits the message and outbox row.
- Postgres is authoritative. Redis stores only ephemeral or derived state and BullMQ stores only retryable work.
- No controller, gateway, processor, or provider adapter contains business policy or direct Prisma queries.
- Human chat must remain available when AI or push providers fail.
- Do not carry audio/video media through Socket.IO, Redis, BullMQ, or Nest. WebRTC events carry signalling only.
- Multipart upload is the supported media path. Legacy base64 input is bounded, metered, provider-backed, and transitional; local-disk upload storage is prohibited.
- No mixed Express/Nest chat writers. Cut over and roll back the complete domain as one unit.
- Use failing tests first. After every task run its focused suite, `pnpm typecheck`, and `pnpm lint`; before cutover run every programme gate.
- Never log credentials, session material, raw message bodies, raw media, signed URLs, or raw provider exceptions.

## Planned File Structure

- `src/realtime/*`: Redis lifecycle, Socket.IO adapter, handshake authentication, presence, rate limits, room naming, health, and shutdown.
- `src/chat/*`: public contracts, application service, Prisma boundary, REST controller, Socket.IO gateway, and compatibility serializers.
- `src/chat-media/*`: multipart controller, file policy, attachment service, provider port extension, and bounded base64 adapter.
- `src/chat-delivery/*`: outbox boundary, BullMQ dispatcher/worker, push port, reconciliation, and health.
- `src/video-calls/*`: authorized WebRTC signalling application service and gateway.
- `src/bot/*`: REST contracts, service, Prisma boundary, AI port/adapters, and controller.
- `prisma/data-migrations/chat-realtime-cutover.sql`: idempotent additive schema/backfill required before ownership switches.
- `test/chat-realtime/*`: contracts, persistence, REST, realtime, media, calls, bot, degradation, two-replica, performance, and cutover evidence.

---

### Task 1: Lock Capability Ownership and Generate the Nest Skeleton

**Files:**

- Create: `docs/nestjs-migration/domains/chat-realtime-owners.json`
- Modify: `docs/nestjs-migration/nest-cli-ledger.md`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `src/app.module.ts`
- Create: `src/realtime/realtime.module.ts`
- Create: `src/chat/chat.module.ts`
- Create: `src/chat-media/chat-media.module.ts`
- Create: `src/chat-delivery/chat-delivery.module.ts`
- Create: `src/video-calls/video-calls.module.ts`
- Create: `src/bot/bot.module.ts`
- Create: `test/chat-realtime/ownership.spec.ts`
- Create: `test/chat-realtime/jest.config.json`
- Create: `test/chat-realtime/tsconfig.json`

**Interfaces:**

- Consumes: the 102 IDs in `chat-realtime.json` and the six approved module boundaries.
- Produces: one owner tuple per capability and six generated modules imported by `AppModule`.

- [ ] **Step 1: Write the failing ownership test**

```ts
const manifest = readJson(
  'docs/nestjs-migration/domains/chat-realtime.json',
) as {
  capabilityIds: readonly string[];
};
const owners = readJson(
  'docs/nestjs-migration/domains/chat-realtime-owners.json',
) as Readonly<Record<string, readonly [string]>>;

expect(manifest.capabilityIds).toHaveLength(102);
expect(new Set(Object.keys(owners))).toEqual(new Set(manifest.capabilityIds));
expect(
  Object.values(owners).every(([owner]) =>
    [
      'chat',
      'chat-media',
      'chat-delivery',
      'video-calls',
      'bot',
      'realtime',
    ].includes(owner),
  ),
).toBe(true);
```

- [ ] **Step 2: Run the test and confirm the missing owners file fails**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --config test/chat-realtime/jest.config.json --runInBand test/chat-realtime/ownership.spec.ts`

Expected: FAIL because `chat-realtime-owners.json` and generated modules do not exist.

- [ ] **Step 3: Generate modules and install only required transport packages**

Run these commands individually and record each successful command and path in the CLI ledger:

```powershell
pnpm exec nest generate module realtime --no-spec
pnpm exec nest generate module chat --no-spec
pnpm exec nest generate module chat-media --no-spec
pnpm exec nest generate module chat-delivery --no-spec
pnpm exec nest generate module video-calls --no-spec
pnpm exec nest generate module bot --no-spec
pnpm add @nestjs/websockets@^11 @nestjs/platform-socket.io@^11 socket.io@^4 @socket.io/redis-adapter@^8 file-type@^21
pnpm add -D autocannon@^8 socket.io-client@^4 @types/autocannon@^7 tsx@^4
```

Assign each ID exactly once: models, chat REST, and message events to `chat`; upload routes/events to `chat-media`; AI models/providers/routes/events to `bot`; signalling events to `video-calls`; push provider to `chat-delivery`; connection, disconnect, presence, and root fan-out to `realtime`.

- [ ] **Step 4: Run ownership and compile gates**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --config test/chat-realtime/jest.config.json --runInBand test/chat-realtime/ownership.spec.ts && pnpm typecheck && pnpm lint`

Expected: PASS with 102 unique owners and no type or lint errors.

- [ ] **Step 5: Commit the scaffold**

```powershell
git add -- package.json pnpm-lock.yaml src/app.module.ts src/realtime src/chat src/chat-media src/chat-delivery src/video-calls src/bot docs/nestjs-migration/nest-cli-ledger.md docs/nestjs-migration/domains/chat-realtime-owners.json test/chat-realtime
git commit -m "chore: scaffold chat realtime domain"
```

### Task 2: Define Public Contracts and Compatibility Views

**Files:**

- Create: `src/chat/chat.contract.ts`
- Create: `src/chat/chat-events.contract.ts`
- Create: `src/chat/chat-compatibility.ts`
- Create: `src/bot/bot.contract.ts`
- Create: `src/video-calls/video-call.contract.ts`
- Create: `src/chat-media/chat-media.contract.ts`
- Create: `test/chat-realtime/contracts.spec.ts`
- Create: `test/chat-realtime/fixtures/legacy-rest.json`
- Create: `test/chat-realtime/fixtures/legacy-socket-events.json`

**Interfaces:**

- Consumes: exact request fields and response/event shapes captured from the read-only legacy routes and sockets.
- Produces: `ChatCommand`, `ChatEventMap`, `ChatAck`, `ChatPublicView`, `BotCommand`, `CallSignal`, and media schemas used by every later adapter.

- [ ] **Step 1: Capture legacy fixtures and write parser/view failures**

```ts
expect(
  parseSendMessage({ chatId: 'c1', receiverId: 'u2', content: 'hi' }),
).toEqual({
  chatId: 'c1',
  receiverId: 'u2',
  content: 'hi',
  clientMessageId: undefined,
});
expect(() =>
  parseSendMessage({ chatId: '', content: 'x'.repeat(65_537) }),
).toThrow();
expect(toLegacyMessageSent(record)).toEqual(legacyEvents.message_sent);
expect(toLegacyNewMessage(record)).toEqual(legacyEvents.new_message);
expect(Object.keys(inboundEventSchemas).sort()).toEqual(
  legacyEvents.inboundNames.sort(),
);
expect(Object.keys(outboundEventViews).sort()).toEqual(
  legacyEvents.outboundNames.sort(),
);
```

Capture fixtures from returned objects and explicit `socket.emit()` payloads, not from comments or documentation. Store synthetic IDs, timestamps, URLs, and message text; never copy production data.

- [ ] **Step 2: Run contracts and confirm missing parsers fail**

Run: `pnpm exec jest --config test/chat-realtime/jest.config.json --runInBand test/chat-realtime/contracts.spec.ts`

Expected: FAIL because the contract exports are absent.

- [ ] **Step 3: Implement strict Zod contracts and typed compatibility maps**

```ts
export const sendMessageSchema = z
  .object({
    chatId: z.string().uuid(),
    receiverId: z.string().uuid().optional(),
    content: z.string().trim().min(1).max(65_536),
    clientMessageId: z.string().uuid().optional(),
    replyToId: z.string().uuid().optional(),
    attachments: z.array(z.string().uuid()).max(10).default([]),
  })
  .strict();

export type SendMessageCommand = z.infer<typeof sendMessageSchema> & {
  readonly principalId: string;
};

export interface ChatAck {
  readonly success: true;
  readonly messageId: string;
  readonly clientMessageId?: string;
  readonly timestamp: string;
}
```

Define one schema for each inbound event and REST body/query, one typed serializer for each outbound event and REST success view, stable `WsPublicError` codes, maximum pagination sizes, and no `z.any()`.

- [ ] **Step 4: Prove every manifest transport capability has a contract**

Run: `pnpm exec jest --config test/chat-realtime/jest.config.json --runInBand test/chat-realtime/contracts.spec.ts && pnpm typecheck && pnpm lint`

Expected: PASS with all 34 REST and 58 socket capabilities represented.

- [ ] **Step 5: Commit contracts**

```powershell
git add -- src/chat src/bot src/video-calls src/chat-media test/chat-realtime/contracts.spec.ts test/chat-realtime/fixtures
git commit -m "feat: define chat realtime contracts"
```

### Task 3: Add Ordered Idempotent Persistence and Transactional Outbox

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/data-migrations/chat-realtime-cutover.sql`
- Create: `src/chat/chat-prisma.client.ts`
- Create: `src/chat-delivery/chat-outbox-prisma.client.ts`
- Create: `test/chat-realtime/persistence.spec.ts`
- Create: `test/migration/chat-realtime-backfill.spec.ts`
- Modify: `test/migration/jest.config.json`

**Interfaces:**

- Consumes: `SendMessageCommand` and the existing Prisma lifecycle client.
- Produces: `ChatStore.appendMessage(command): Promise<PersistedChatMessage>` and `ChatOutboxStore.claimBatch(limit): Promise<readonly OutboxRecord[]>`.

- [ ] **Step 1: Write failing PGlite and boundary tests**

```ts
const [first, retry] = await Promise.all([
  store.appendMessage(command),
  store.appendMessage(command),
]);
expect(first.id).toBe(retry.id);
expect(await countMessages(command.chatId)).toBe(1);
expect(await countOutbox(first.id)).toBe(1);

const sequences = await Promise.all(
  Array.from({ length: 20 }, (_, index) =>
    store.appendMessage({ ...command, clientMessageId: uuidFor(index) }),
  ),
);
expect(sequences.map(({ sequence }) => sequence).sort((a, b) => a - b)).toEqual(
  Array.from({ length: 20 }, (_, index) => index + 1),
);
```

The migration test must execute the SQL against legacy-shaped rows, run it twice, and prove existing IDs, messages, and timestamps remain unchanged.

- [ ] **Step 2: Run persistence and migration tests to observe missing schema**

Run: `pnpm exec jest --config test/chat-realtime/jest.config.json --runInBand test/chat-realtime/persistence.spec.ts && pnpm test:migration -- test/migration/chat-realtime-backfill.spec.ts`

Expected: FAIL because sequence, idempotency, and outbox storage do not exist.

- [ ] **Step 3: Add additive rollback-safe schema**

Add these fields and model using the repository's Prisma naming conventions:

```prisma
model Chat {
  nextMessageSequence BigInt @default(0)
  outboxEvents ChatOutboxEvent[]
}

model EnhancedMessage {
  clientMessageId String?
  sequence BigInt?
  @@unique([chatId, clientMessageId])
  @@unique([chatId, sequence])
}

model Message {
  clientMessageId String?
  sequence BigInt?
  @@unique([chatId, clientMessageId])
  @@unique([chatId, sequence])
}

model ChatOutboxEvent {
  @@map("chat_outbox_events")
  id String @id @default(uuid())
  chatId String
  aggregateId String
  eventType String
  payload Json
  attempts Int @default(0)
  availableAt DateTime @default(now())
  claimedAt DateTime?
  completedAt DateTime?
  failedAt DateTime?
  lastErrorCode String?
  createdAt DateTime @default(now())
  chat Chat @relation(fields: [chatId], references: [id], onDelete: Cascade)
  @@index([completedAt, availableAt])
  @@index([chatId, createdAt])
}
```

Allocate a sequence by atomically incrementing `Chat.nextMessageSequence` inside the same `Serializable` transaction that inserts the message and outbox row. On unique idempotency conflict, read and return the existing message without creating another outbox row. Retry only Prisma `P2034` conflicts with the existing bounded retry pattern.

- [ ] **Step 4: Generate Prisma and prove ordering/outbox invariants**

Run: `pnpm prisma:generate && pnpm prisma:validate && pnpm exec jest --config test/chat-realtime/jest.config.json --runInBand test/chat-realtime/persistence.spec.ts && pnpm test:migration -- test/migration/chat-realtime-backfill.spec.ts && pnpm typecheck && pnpm lint`

Expected: PASS; the migration suite count increases and both idempotency and 20-writer ordering pass.

- [ ] **Step 5: Commit persistence**

```powershell
git add -- prisma/schema.prisma prisma/data-migrations/chat-realtime-cutover.sql prisma/generated src/chat/chat-prisma.client.ts src/chat-delivery/chat-outbox-prisma.client.ts test/chat-realtime/persistence.spec.ts test/migration/chat-realtime-backfill.spec.ts test/migration/jest.config.json
git commit -m "feat: persist ordered chat messages and outbox"
```

### Task 4: Build Redis Realtime Infrastructure With Explicit Degradation

**Files:**

- Create: `src/realtime/redis-connections.service.ts`
- Create: `src/realtime/socket-io-redis.adapter.ts`
- Create: `src/realtime/realtime-auth.service.ts`
- Create: `src/realtime/presence.service.ts`
- Create: `src/realtime/realtime-rate-limiter.service.ts`
- Create: `src/realtime/chat-membership-cache.service.ts`
- Create: `src/realtime/realtime-health.service.ts`
- Modify: `src/realtime/realtime.module.ts`
- Modify: `src/configuration/configuration/configuration.service.ts`
- Modify: `src/main.ts`
- Create: `test/chat-realtime/realtime-infrastructure.spec.ts`

**Interfaces:**

- Consumes: `ConfigurationService.redisUrl`, trusted origins, Better Auth session resolution, and chat membership reads.
- Produces: `RealtimePrincipal`, `PresencePort`, `RealtimeRateLimiter`, `MembershipCache`, `RealtimeHealth`, and the application-wide Socket.IO adapter.

- [ ] **Step 1: Write failure-first infrastructure tests**

```ts
expect(await auth.authenticate(handshakeWithValidSession())).toMatchObject({
  userId: USER_ID,
});
await expect(
  auth.authenticate(handshakeWithoutSession()),
).rejects.toMatchObject({
  code: 'AUTHENTICATION_REQUIRED',
});
expect(room.chat(CHAT_ID)).toBe(`aeko:chat:${CHAT_ID}`);
expect(
  await limiter.consume({ principalId: USER_ID, event: 'send_message' }),
).toBe('allow');
expect(await exhaust(limiter, USER_ID, 'typing_start')).toBe('drop-ephemeral');
expect(health.snapshot().adapter).toBe('degraded');
```

Also assert publisher, subscriber, cache, and BullMQ clients are not shared as one connection and all close during module destruction.

- [ ] **Step 2: Run and confirm missing services fail**

Run: `pnpm exec jest --config test/chat-realtime/jest.config.json --runInBand test/chat-realtime/realtime-infrastructure.spec.ts`

Expected: FAIL because Redis lifecycle and adapter services are absent.

- [ ] **Step 3: Implement lifecycle-owned Redis and Socket.IO adapter**

```ts
export interface RealtimeHealthSnapshot {
  readonly adapter: 'ready' | 'degraded' | 'disabled';
  readonly presence: 'ready' | 'degraded';
  readonly rateLimits: 'distributed' | 'local-safe-mode';
  readonly lastErrorCode: string | null;
}

export abstract class PresencePort {
  abstract heartbeat(userId: string, connectionId: string): Promise<void>;
  abstract disconnect(userId: string, connectionId: string): Promise<void>;
  abstract isOnline(userId: string): Promise<boolean>;
}
```

Use namespaced keys, heartbeat leases, atomic Lua/token-bucket operations, membership TTL plus active invalidation, trusted-origin handshake checks, and bounded local safe-mode limits when Redis is unavailable. Do not advertise multi-replica readiness unless the Redis adapter is active. Register the custom adapter with `app.useWebSocketAdapter(adapter)` before `listen()`.

- [ ] **Step 4: Run infrastructure, lifecycle, type, and lint gates**

Run: `pnpm exec jest --config test/chat-realtime/jest.config.json --runInBand test/chat-realtime/realtime-infrastructure.spec.ts && pnpm typecheck && pnpm lint`

Expected: PASS with deterministic degraded states and no open handles.

- [ ] **Step 5: Commit realtime infrastructure**

```powershell
git add -- src/realtime src/configuration/configuration/configuration.service.ts src/main.ts test/chat-realtime/realtime-infrastructure.spec.ts
git commit -m "feat: add scalable realtime infrastructure"
```

### Task 5: Implement the Chat Application Service and 18 Core Chat REST Contracts

**Files:**

- Create: `src/chat/chat.service.ts`
- Create: `src/chat/chat-authorization.service.ts`
- Create: `src/chat/chat.controller.ts`
- Modify: `src/chat/chat.module.ts`
- Create: `test/chat-realtime/chat-service.spec.ts`
- Create: `test/chat-realtime/chat-rest.spec.ts`

**Interfaces:**

- Consumes: `ChatStore`, `MembershipCache`, contracts, `AuthenticatedPrincipal`, and compatibility serializers.
- Produces: commands/queries for conversations, groups, messages, reactions, reads, search, and history, plus the 18 core chat routes. Tasks 7 and 9 add four media routes and twelve bot/assist routes, completing the 34-route manifest.

- [ ] **Step 1: Write service authorization and REST parity tests**

```ts
await expect(service.sendMessage(OUTSIDER, input)).rejects.toMatchObject({
  code: 'AUTHORIZATION_DENIED',
});
const result = await service.sendMessage(MEMBER, input);
expect(result.sequence).toBe(1);
expect(store.calls).toEqual(['assertMember', 'appendMessage']);

expect(new Set(routesOf(ChatController))).toEqual(
  new Set(expectedCoreChatRoutes),
);
await request(app)
  .post('/api/enhanced-chat/send-message')
  .set(sessionHeader(MEMBER))
  .send(legacyRequest)
  .expect(legacyStatus)
  .expect(legacySuccessBody);
```

Cover create/list/delete conversations, group create/invite/join/leave/member removal, send/edit/delete/reply/search/history, reactions, mark-read, emoji list, user list, and both legacy `/api/chat` routes. Group-icon upload belongs to Task 7; assist and bot-chat belong to Task 9.

- [ ] **Step 2: Run service and REST tests to verify failure**

Run: `pnpm exec jest --config test/chat-realtime/jest.config.json --runInBand test/chat-realtime/chat-service.spec.ts test/chat-realtime/chat-rest.spec.ts`

Expected: FAIL because service/controller exports and routes are absent.

- [ ] **Step 3: Implement thin controller and transport-independent service**

```ts
async sendMessage(
  principal: AuthenticatedPrincipal,
  input: SendMessageInput,
): Promise<PersistedChatMessage> {
  await this.authorization.assertMember(principal.userId, input.chatId);
  if (input.receiverId !== undefined) {
    await this.authorization.assertMember(input.receiverId, input.chatId);
  }
  return this.store.appendMessage({ ...input, principalId: principal.userId });
}
```

Use bounded cursor pagination, indexed search inputs, explicit update field presence, membership invalidation on every mutation, safe `DomainError` mappings, and no request/response objects in the service.

- [ ] **Step 4: Run focused and static gates**

Run: `pnpm exec jest --config test/chat-realtime/jest.config.json --runInBand test/chat-realtime/chat-service.spec.ts test/chat-realtime/chat-rest.spec.ts && pnpm typecheck && pnpm lint`

Expected: PASS for the 18 core chat REST contracts; the contract inventory still reports four media and twelve bot/assist routes open.

- [ ] **Step 5: Commit chat REST slice**

```powershell
git add -- src/chat test/chat-realtime/chat-service.spec.ts test/chat-realtime/chat-rest.spec.ts
git commit -m "feat: migrate chat rest capabilities"
```

### Task 6: Implement Socket.IO Chat, Presence, Receipts, and Reconnect Recovery

**Files:**

- Create: `src/chat/chat.gateway.ts`
- Create: `src/chat/chat-event-publisher.ts`
- Create: `src/chat/chat-recovery.service.ts`
- Modify: `src/chat/chat.module.ts`
- Create: `test/chat-realtime/chat-gateway.spec.ts`
- Create: `test/chat-realtime/reconnect-recovery.spec.ts`

**Interfaces:**

- Consumes: chat application commands, `RealtimePrincipal`, contracts, presence/rate-limit ports, and compatibility views.
- Produces: all non-bot, non-media, non-call root namespace events and `recoverAfter(chatId, sequence)`.

- [ ] **Step 1: Write gateway and recovery failures**

```ts
client.emit('send_message', legacyInput, ack);
await eventually(() => expect(ack).toHaveBeenCalledWith(legacyAck));
expect(store.messageCount()).toBe(1);
expect(recipient.events('new_message')).toEqual([legacyNewMessage]);

client.disconnect();
await store.seedMessages(CHAT_ID, [2, 3, 4]);
expect(await recovery.after(MEMBER.userId, CHAT_ID, 1)).toEqual([
  messageAt(2),
  messageAt(3),
  messageAt(4),
]);
```

Add tests for join, send, emoji, reactions, read receipts, edit/delete/reply, typing start/stop, recording start/stop, search/history, presence, dropped acknowledgement retry, and non-member rejection.

- [ ] **Step 2: Run gateway tests and observe missing handlers**

Run: `pnpm exec jest --config test/chat-realtime/jest.config.json --runInBand test/chat-realtime/chat-gateway.spec.ts test/chat-realtime/reconnect-recovery.spec.ts`

Expected: FAIL because the gateway and recovery service do not exist.

- [ ] **Step 3: Implement a thin Nest gateway**

```ts
@SubscribeMessage('send_message')
async sendMessage(
  @ConnectedSocket() socket: AuthenticatedSocket,
  @MessageBody() body: unknown,
  @Ack() ack: (value: ChatAck | WsPublicError) => void,
): Promise<void> {
  const input = parseSendMessage(body);
  const message = await this.chat.sendMessage(socket.data.principal, input);
  ack(toLegacyMessageSent(message));
  await this.publisher.messageCreated(message);
}
```

Wrap handlers with one reusable safe-execution boundary that maps `DomainError` to the exact legacy error event without exposing internal exceptions. Join rooms only after authorization. Drop/coalesce ephemeral events under pressure before durable sends. Recovery reads Postgres by sequence cursor.

- [ ] **Step 4: Prove event parity and durable reconnect**

Run: `pnpm exec jest --config test/chat-realtime/jest.config.json --runInBand test/chat-realtime/chat-gateway.spec.ts test/chat-realtime/reconnect-recovery.spec.ts && pnpm typecheck && pnpm lint`

Expected: PASS with one durable row after acknowledgement retry and ordered reconnect output.

- [ ] **Step 5: Commit the chat gateway**

```powershell
git add -- src/chat test/chat-realtime/chat-gateway.spec.ts test/chat-realtime/reconnect-recovery.spec.ts
git commit -m "feat: migrate realtime chat events"
```

### Task 7: Move Chat Media to Multipart With a Bounded Legacy Adapter

**Files:**

- Modify: `src/providers/media/media.port.ts`
- Modify: `src/providers/media/cloudinary-media.adapter.ts`
- Create: `src/chat-media/chat-attachment.service.ts`
- Create: `src/chat-media/chat-media.controller.ts`
- Create: `src/chat-media/legacy-base64-media.adapter.ts`
- Modify: `src/chat-media/chat-media.module.ts`
- Create: `test/chat-realtime/chat-media.spec.ts`

**Interfaces:**

- Consumes: authenticated principal, `MediaPort`, attachment policy, and legacy upload events/routes.
- Produces: `uploadAttachment(input): Promise<ChatAttachment>` and compatibility results for upload-file/upload-voice/send-voice-message.

This task closes the four media-owned REST capabilities: group-icon upload, file upload, voice upload, and authenticated legacy upload retrieval.

- [ ] **Step 1: Write upload policy and compatibility failures**

```ts
await request(app)
  .post('/api/enhanced-chat/upload-file')
  .set(sessionHeader(MEMBER))
  .attach('file', PNG_BYTES, {
    filename: 'avatar.exe',
    contentType: 'image/png',
  })
  .expect(400);

await expect(
  legacy.decode(`data:audio/webm;base64,${oversized}`),
).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
expect(localDiskWrites()).toBe(0);
```

Test byte-signature mismatch, unsupported MIME, per-class limits, ten-attachment cap, provider failure before message creation, private retrieval authorization, base64 telemetry, and no raw bytes in queue jobs.

- [ ] **Step 2: Run media tests to verify missing endpoint and policy**

Run: `pnpm exec jest --config test/chat-realtime/jest.config.json --runInBand test/chat-realtime/chat-media.spec.ts`

Expected: FAIL because chat attachment APIs and generic media upload port are absent.

- [ ] **Step 3: Extend the media port and implement bounded ingestion**

```ts
export interface UploadAttachmentInput {
  readonly ownerId: string;
  readonly chatId: string;
  readonly bytes: Uint8Array;
  readonly declaredMimeType: string;
  readonly filename: string;
}

export abstract class MediaPort {
  abstract uploadProfileImage(input: UploadImageInput): Promise<UploadedMedia>;
  abstract deleteProfileImage(providerId: string): Promise<void>;
  abstract uploadChatAttachment(
    input: UploadAttachmentInput,
  ): Promise<UploadedMedia>;
}
```

Use Nest multipart interceptors with explicit memory limits, `file-type` byte inspection, sanitized filenames used only as metadata, Cloudinary/provider storage, and a maximum 1 MiB legacy socket payload. Do not create or serve local upload directories.

- [ ] **Step 4: Run media and provider regression gates**

Run: `pnpm exec jest --config test/chat-realtime/jest.config.json --runInBand test/chat-realtime/chat-media.spec.ts && pnpm exec jest --config test/ads-media/jest.config.json --runInBand && pnpm typecheck && pnpm lint`

Expected: PASS for new media behavior and existing ads/profile media behavior.

- [ ] **Step 5: Commit chat media**

```powershell
git add -- src/providers/media src/chat-media test/chat-realtime/chat-media.spec.ts
git commit -m "feat: add secure chat media uploads"
```

### Task 8: Secure WebRTC Signalling

**Files:**

- Create: `src/video-calls/video-call-authorization.service.ts`
- Create: `src/video-calls/video-calls.gateway.ts`
- Modify: `src/video-calls/video-calls.module.ts`
- Create: `test/chat-realtime/video-calls.spec.ts`

**Interfaces:**

- Consumes: authenticated socket principal, call contracts, and chat membership boundary.
- Produces: legacy-compatible `call-offer`, `call-answer`, and `ice-candidate` relay behavior for authorized peers only.

- [ ] **Step 1: Write blind-relay regression tests**

```ts
await expect(
  calls.offer(ATTACKER, { targetUserId: VICTIM_ID, offer }),
).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
await calls.offer(MEMBER_A, {
  targetUserId: MEMBER_B.userId,
  chatId: CHAT_ID,
  offer,
});
expect(memberB.events('call-offer')).toEqual([legacyOfferPayload]);
expect(serverMediaBytes()).toBe(0);
```

- [ ] **Step 2: Run call tests and confirm insecure legacy behavior is absent from Nest**

Run: `pnpm exec jest --config test/chat-realtime/jest.config.json --runInBand test/chat-realtime/video-calls.spec.ts`

Expected: FAIL because signalling gateway and authorization service do not exist.

- [ ] **Step 3: Implement authenticated peer signalling**

Resolve target connections from server-owned presence state, require both users to share the named chat, bound SDP and ICE payload sizes, rate-limit negotiation events separately, and emit safe stable errors. Never relay to an arbitrary client-supplied socket ID.

```ts
async assertPeers(callerId: string, targetId: string, chatId: string): Promise<void> {
  const [caller, target] = await Promise.all([
    this.members.isMember(chatId, callerId),
    this.members.isMember(chatId, targetId),
  ]);
  if (!caller || !target) throw new DomainError('AUTHORIZATION_DENIED', 'Call not permitted');
}
```

- [ ] **Step 4: Run signalling, type, and lint gates**

Run: `pnpm exec jest --config test/chat-realtime/jest.config.json --runInBand test/chat-realtime/video-calls.spec.ts && pnpm typecheck && pnpm lint`

Expected: PASS with unauthorized relay rejected and all three legacy events preserved.

- [ ] **Step 5: Commit signalling**

```powershell
git add -- src/video-calls test/chat-realtime/video-calls.spec.ts
git commit -m "fix: authorize video call signalling"
```

### Task 9: Implement Bot and AI Capabilities Behind Provider Ports

**Files:**

- Create: `src/providers/ai/chat-ai.port.ts`
- Create: `src/providers/ai/unavailable-chat-ai.adapter.ts`
- Create: `src/providers/ai/http-chat-ai.adapter.ts`
- Create: `src/bot/bot-prisma.client.ts`
- Create: `src/bot/bot.service.ts`
- Create: `src/bot/bot.controller.ts`
- Create: `src/bot/bot.gateway.ts`
- Modify: `src/bot/bot.module.ts`
- Modify: `src/providers/debate-scoring/unavailable-debate-scoring.adapter.ts`
- Create: `test/chat-realtime/bot.spec.ts`

**Interfaces:**

- Consumes: bot contracts, `BotConversation`, `BotSettings`, AI credentials, chat outbox, and the existing `DebateScoringPort` dependency.
- Produces: all bot REST/socket capabilities plus a working debate-scoring adapter backed by the same provider policy.

This task closes twelve REST capabilities: the ten `/api/bot` and `/api/enhanced-bot` routes plus `/api/enhanced-chat/assist` and `/api/enhanced-chat/bot-chat`.

- [ ] **Step 1: Write provider isolation and parity failures**

```ts
ai.rejectWith(new Error('secret provider body'));
await expect(bot.chat(PRINCIPAL, input)).rejects.toMatchObject({
  code: 'PROVIDER_UNAVAILABLE',
  message: 'AI service is temporarily unavailable',
});
expect(humanChat.health()).toBe('ready');
expect(logs()).not.toContain('secret provider body');
```

Cover settings, personalities, conversation history, analytics, rating, summaries, assist, bot chat, enable-in-chat, auto reply, image generation, provider selection, moderation metadata, and token/response-time recording.

- [ ] **Step 2: Run bot tests and observe unavailable implementation**

Run: `pnpm exec jest --config test/chat-realtime/jest.config.json --runInBand test/chat-realtime/bot.spec.ts`

Expected: FAIL because bot services and provider ports are missing.

- [ ] **Step 3: Implement provider-neutral bot orchestration**

```ts
export abstract class ChatAiPort {
  abstract reply(input: AiReplyInput): Promise<AiReply>;
  abstract summarize(input: AiSummaryInput): Promise<AiSummary>;
  abstract generateImage(input: AiImageInput): Promise<AiImage>;
  abstract scoreDebate(input: AiDebateScoreInput): Promise<AiDebateScore>;
}
```

Run long AI operations through outbox/BullMQ when the public contract permits asynchronous response; preserve synchronous legacy responses where required with strict timeouts and bulkheads. Store safe usage metadata, not secrets. A provider failure must not change realtime chat readiness.

- [ ] **Step 4: Run bot and debate regression gates**

Run: `pnpm exec jest --config test/chat-realtime/jest.config.json --runInBand test/chat-realtime/bot.spec.ts && pnpm exec jest --config test/debates-challenges-spaces/jest.config.json --runInBand && pnpm typecheck && pnpm lint`

Expected: PASS, including the previously unavailable debate-scoring dependency.

- [ ] **Step 5: Commit bot capabilities**

```powershell
git add -- src/providers/ai src/providers/debate-scoring src/bot test/chat-realtime/bot.spec.ts
git commit -m "feat: migrate chat bot capabilities"
```

### Task 10: Dispatch Outbox Work Through Idempotent BullMQ Workers

**Files:**

- Create: `src/providers/push/chat-push.port.ts`
- Create: `src/providers/push/unavailable-chat-push.adapter.ts`
- Create: `src/chat-delivery/chat-delivery.contract.ts`
- Create: `src/chat-delivery/chat-outbox-dispatcher.service.ts`
- Create: `src/chat-delivery/chat-delivery.worker.ts`
- Create: `src/chat-delivery/chat-delivery-health.service.ts`
- Modify: `src/chat-delivery/chat-delivery.module.ts`
- Create: `test/chat-realtime/chat-delivery.spec.ts`
- Create: `test/chat-realtime/degradation.spec.ts`

**Interfaces:**

- Consumes: outbox records, separate BullMQ Redis connection, push/AI/media ports, and presence.
- Produces: idempotent `dispatchBatch()`, worker handlers keyed by event ID, dead-letter state, replay API for internal administration, and health metrics.

- [ ] **Step 1: Write crash, retry, and outage tests**

```ts
await store.seedPending(EVENT_ID);
worker.failAfterSideEffectOnce(EVENT_ID);
await dispatcher.dispatchBatch();
await dispatcher.dispatchBatch();
expect(push.deliveriesFor(EVENT_ID)).toHaveLength(1);
expect(await store.status(EVENT_ID)).toBe('completed');

queue.disconnect();
const message = await chat.sendMessage(MEMBER, input);
expect(message.id).toBeDefined();
expect(await store.statusForAggregate(message.id)).toBe('pending');
```

Test bounded attempts, exponential backoff with jitter, timeout, concurrency, terminal failure, safe error codes, recovery after queue restoration, and shutdown drain.

- [ ] **Step 2: Run delivery tests to verify missing workers**

Run: `pnpm exec jest --config test/chat-realtime/jest.config.json --runInBand test/chat-realtime/chat-delivery.spec.ts test/chat-realtime/degradation.spec.ts`

Expected: FAIL because dispatcher, worker, and delivery health are absent.

- [ ] **Step 3: Implement outbox claiming and idempotent jobs**

```ts
export const CHAT_DELIVERY_QUEUE = 'aeko:chat-delivery';

export interface ChatDeliveryJob {
  readonly outboxEventId: string;
  readonly aggregateId: string;
  readonly eventType:
    'message.created' | 'bot.requested' | 'media.scan.requested';
}
```

Claim rows using a bounded batch and `FOR UPDATE SKIP LOCKED` semantics, enqueue with `jobId = outboxEventId`, and mark completion only after the owned idempotent effect succeeds. Persist terminal safe error codes. Keep pending rows recoverable when Redis/BullMQ is unavailable.

- [ ] **Step 4: Run delivery, degradation, type, and lint gates**

Run: `pnpm exec jest --config test/chat-realtime/jest.config.json --runInBand test/chat-realtime/chat-delivery.spec.ts test/chat-realtime/degradation.spec.ts && pnpm typecheck && pnpm lint`

Expected: PASS with one provider effect across crash/retry and durable pending outbox during queue outage.

- [ ] **Step 5: Commit delivery infrastructure**

```powershell
git add -- src/providers/push src/chat-delivery test/chat-realtime/chat-delivery.spec.ts test/chat-realtime/degradation.spec.ts
git commit -m "feat: deliver chat effects through bullmq"
```

### Task 11: Prove Two-Replica Correctness, Backpressure, and Performance

**Files:**

- Create: `test/chat-realtime/two-replica.spec.ts`
- Create: `test/chat-realtime/backpressure.spec.ts`
- Create: `test/chat-realtime/load/chat-load.ts`
- Create: `test/chat-realtime/load/legacy-chat-load.ts`
- Create: `test/chat-realtime/load/report.ts`
- Create: `docs/nestjs-migration/chat-realtime-benchmark.md`
- Modify: `package.json`

**Interfaces:**

- Consumes: two Nest application instances, test Postgres, test Redis, Socket.IO clients, and equivalent seeded legacy/Nest workloads.
- Produces: executable cross-replica proof and a checked-in benchmark report with p50/p95/p99, throughput, error rate, CPU, memory, database load, Redis load, and queue lag.

- [ ] **Step 1: Write cross-replica and pressure failures**

```ts
const sender = await connect(replicaA, MEMBER_A);
const recipient = await connect(replicaB, MEMBER_B);
await sender.emitWithAck('send_message', input);
expect(await recipient.next('new_message')).toEqual(legacyNewMessage);

await flood(sender, 'typing_start', 10_000);
expect(await sender.emitWithAck('send_message', durableInput)).toMatchObject({
  success: true,
});
expect(metrics.droppedEphemeral).toBeGreaterThan(0);
expect(metrics.lostAcknowledgedMessages).toBe(0);
```

- [ ] **Step 2: Run without the adapter/load controls and confirm failure**

Run: `pnpm exec jest --config test/chat-realtime/jest.config.json --runInBand test/chat-realtime/two-replica.spec.ts test/chat-realtime/backpressure.spec.ts`

Expected: FAIL if fan-out is process-local or ephemeral floods starve durable messages.

- [ ] **Step 3: Add reproducible benchmark scripts and budgets**

Add scripts:

```json
{
  "test:chat-realtime": "jest --config test/chat-realtime/jest.config.json --runInBand",
  "bench:chat:legacy": "tsx test/chat-realtime/load/legacy-chat-load.ts",
  "bench:chat:nest": "tsx test/chat-realtime/load/chat-load.ts",
  "bench:chat:report": "tsx test/chat-realtime/load/report.ts"
}
```

Seed the same users, memberships, history, message sizes, concurrency, warmup, duration, and hardware limits. Record exact commands, environment, raw sample paths, and numerical acceptance budgets derived from the legacy run. Fail the report command when Nest exceeds an approved latency/error/resource tolerance or loses a cross-replica event.

- [ ] **Step 4: Run two-replica and benchmark gates**

Run: `pnpm test:chat-realtime -- test/chat-realtime/two-replica.spec.ts test/chat-realtime/backpressure.spec.ts && pnpm bench:chat:legacy && pnpm bench:chat:nest && pnpm bench:chat:report`

Expected: PASS; two-replica delivery is complete, acknowledged-message loss is zero, and the report records Nest at or better than the approved legacy tolerance.

- [ ] **Step 5: Commit reliability evidence**

```powershell
git add -- package.json test/chat-realtime/two-replica.spec.ts test/chat-realtime/backpressure.spec.ts test/chat-realtime/load docs/nestjs-migration/chat-realtime-benchmark.md
git commit -m "test: prove scalable chat delivery"
```

### Task 12: Close 102 Capabilities and Prove Atomic Cutover/Rollback

**Files:**

- Create: `test/chat-realtime/cutover.spec.ts`
- Create: `test/migration/chat-realtime-coverage.spec.ts`
- Modify: `test/migration/jest.config.json`
- Modify: `docs/nestjs-migration/domains/chat-realtime.json`
- Modify: `docs/nestjs-migration/corrections.json`
- Create: `docs/nestjs-migration/chat-realtime-compatibility.md`

**Interfaces:**

- Consumes: all domain modules, owners, fixtures, corrections, migration SQL, benchmark report, health/degradation evidence, and 102-ID manifest.
- Produces: `migration.status = implemented`, 102 assigned, zero missing/duplicate/unresolved, atomic ownership assertions, compatibility record, and rollback proof.

- [ ] **Step 1: Write failing closure and cutover assertions**

```ts
expect(manifest.migration).toEqual({
  status: 'implemented',
  assigned: 102,
  missing: 0,
  duplicate: 0,
  unresolved: 0,
});
expect(new Set(Object.keys(owners))).toEqual(new Set(manifest.capabilityIds));
expect(routeSet()).toEqual(expected34Routes);
expect(socketCapabilitySet()).toEqual(expected58Capabilities);
expect(runtimeOwners()).toEqual({ express: [], nest: manifest.capabilityIds });
expect(rollbackProbe()).toEqual({ compatibleData: true, dualWriters: false });
```

Assert the source has no local upload writes, wildcard socket CORS, in-process authoritative presence maps, raw error-message emission, unguarded target-socket relay, or unbounded message/history reads.

- [ ] **Step 2: Run closure tests and confirm the manifest is still open**

Run: `pnpm exec jest --config test/chat-realtime/jest.config.json --runInBand test/chat-realtime/cutover.spec.ts && pnpm test:migration -- test/migration/chat-realtime-coverage.spec.ts`

Expected: FAIL until migration metadata, corrections, compatibility evidence, and test allowlists are complete.

- [ ] **Step 3: Register corrections and write compatibility evidence**

Register approved corrections for cross-replica delivery, room/message authorization, secure call signalling, bounded frames/uploads, provider-safe errors, distributed rate limits, idempotent retries, durable outbox delivery, and unread reconciliation. For each correction record legacy evidence, Nest owner, test path, and status. Document every REST/event contract, intentional failure difference, Redis/BullMQ dependency mode, upload migration, cutover command, rollback command, and benchmark result.

- [ ] **Step 4: Run the complete programme gate**

Run in order:

```powershell
pnpm test:chat-realtime
pnpm exec jest --config test/auth-users-security/jest.config.json --runInBand
pnpm exec jest --config test/ads-media/jest.config.json --runInBand
pnpm exec jest --config test/content-social/jest.config.json --runInBand
pnpm exec jest --config test/debates-challenges-spaces/jest.config.json --runInBand
pnpm exec jest --config test/payments-subscriptions/jest.config.json --runInBand
pnpm exec jest --config test/communities/jest.config.json --runInBand
pnpm test:migration
pnpm format:check
pnpm lint
pnpm typecheck
pnpm prisma:validate
pnpm build
pnpm bench:chat:report
```

Expected: every command exits 0; chat reports 102/102 closed; all prior domain counts remain unchanged; no test file is silently excluded; the benchmark remains within its checked-in budget.

- [ ] **Step 5: Obtain independent specialist review**

Provide the committed diff, manifest, correction ledger, compatibility document, benchmark report, two-replica evidence, degradation evidence, and all gate output to backend, security, and realtime reviewers. Required result: three Pass decisions with no unresolved critical/high finding. Fix and rerun affected gates before proceeding when any reviewer returns a finding.

- [ ] **Step 6: Commit the atomic cutover record**

```powershell
git add -- test/chat-realtime/cutover.spec.ts test/migration/chat-realtime-coverage.spec.ts test/migration/jest.config.json docs/nestjs-migration/domains/chat-realtime.json docs/nestjs-migration/corrections.json docs/nestjs-migration/chat-realtime-compatibility.md
git commit -m "feat: complete chat realtime cutover"
```

## Plan Self-Review Record

- Spec coverage: Tasks 1-12 cover ownership, contracts, persistence, ordering, idempotency, outbox, Redis, Socket.IO, REST, media, calls, bots, BullMQ, degradation, observability, two-replica correctness, backpressure, benchmarking, corrections, and atomic cutover/rollback.
- Type consistency: `SendMessageCommand` flows from contracts to `ChatService` to `ChatStore.appendMessage`; `PersistedChatMessage` flows to compatibility views and outbox; `outboxEventId` is the BullMQ job ID and provider idempotency key.
- Scope: Domain 8 livestream remains excluded and consumes this domain only after Domain 7 passes cutover.
- Placeholders: the plan contains no deferred implementation markers; numeric benchmark budgets are produced from the mandatory legacy baseline and then enforced by the report command.
