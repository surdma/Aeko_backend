import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  parseSendMessage,
  restRequestSchemas,
  sendMessageSchema,
} from '../../src/chat/chat.contract';
import {
  inboundEventSchemas,
  outboundEventViews,
} from '../../src/chat/chat-events.contract';
import {
  toLegacyMessageSent,
  toLegacyNewMessage,
} from '../../src/chat/chat-compatibility';

const ROOT = join(__dirname, '..', '..');
const readJson = <T>(...path: readonly string[]): T =>
  JSON.parse(readFileSync(join(ROOT, ...path), 'utf8')) as T;

const legacyRest = readJson<{
  message: Record<string, unknown>;
}>('test/chat-realtime/fixtures/legacy-rest.json');
const legacyEvents = readJson<{
  inboundNames: string[];
  outboundNames: string[];
  message_sent: unknown;
  new_message: unknown;
}>('test/chat-realtime/fixtures/legacy-socket-events.json');
const manifest = readJson<{ capabilityIds: string[] }>(
  'docs/nestjs-migration/domains/chat-realtime.json',
);

const CHAT_ID = '22222222-2222-4222-8222-222222222222';
const RECEIVER_ID = '44444444-4444-4444-8444-444444444444';

describe('chat realtime public contracts', () => {
  it('parses the legacy send-message fields without accepting invalid input', () => {
    expect(
      parseSendMessage({ chatId: CHAT_ID, receiverId: RECEIVER_ID, content: 'hi' }),
    ).toEqual({
      chatId: CHAT_ID,
      receiverId: RECEIVER_ID,
      content: 'hi',
      clientMessageId: undefined,
    });
    expect(() =>
      parseSendMessage({ chatId: '', content: 'x'.repeat(65_537) }),
    ).toThrow();
    expect(() =>
      sendMessageSchema.parse({
        chatId: CHAT_ID,
        content: 'hi',
        unexpected: true,
      }),
    ).toThrow();
  });

  it('serializes the legacy message socket payloads', () => {
    expect(toLegacyMessageSent(legacyRest.message)).toEqual(
      legacyEvents.message_sent,
    );
    expect(toLegacyNewMessage(legacyRest.message)).toEqual(
      legacyEvents.new_message,
    );
  });

  it('defines a strict schema or view for every legacy transport capability', () => {
    expect(Object.keys(inboundEventSchemas).sort()).toEqual(
      legacyEvents.inboundNames.sort(),
    );
    expect(Object.keys(outboundEventViews).sort()).toEqual(
      legacyEvents.outboundNames.sort(),
    );
    expect(Object.keys(restRequestSchemas).sort()).toEqual(
      manifest.capabilityIds
        .filter((capabilityId) => capabilityId.startsWith('rest:'))
        .sort(),
    );
    expect(manifest.capabilityIds.filter((id) => id.startsWith('rest:'))).toHaveLength(34);
    expect(manifest.capabilityIds.filter((id) => id.startsWith('socket:'))).toHaveLength(58);
  });
});
