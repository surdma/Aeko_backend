import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ChatController } from '../../src/chat/chat.controller';

const routesOf = (controller: object): Set<string> => {
  const prototype = Object.getPrototypeOf(controller) as Record<
    string,
    unknown
  >;
  const routes = new Set<string>();
  for (const name of Object.getOwnPropertyNames(prototype)) {
    const handler = prototype[name];
    if (typeof handler !== 'function') continue;
    const path = Reflect.getMetadata(PATH_METADATA, handler) as
      string | undefined;
    const method = Reflect.getMetadata(METHOD_METADATA, handler) as
      RequestMethod | undefined;
    if (path !== undefined && method !== undefined)
      routes.add(`${RequestMethod[method]} /${path}`);
  }
  return routes;
};

const expected = [
  'GET /api/enhanced-chat/conversations',
  'DELETE /api/enhanced-chat/conversations/:chatId',
  'GET /api/enhanced-chat/messages/:chatId',
  'DELETE /api/enhanced-chat/messages/:messageId',
  'GET /api/enhanced-chat/search',
  'POST /api/enhanced-chat/emoji-reactions/:messageId',
  'DELETE /api/enhanced-chat/emoji-reactions/:messageId',
  'POST /api/enhanced-chat/mark-read/:chatId',
  'GET /api/enhanced-chat/emoji-list',
  'GET /api/enhanced-chat/users',
  'POST /api/enhanced-chat/create-chat',
  'GET /api/enhanced-chat/groups/:chatId/invite',
  'POST /api/enhanced-chat/groups/join/:inviteCode',
  'DELETE /api/enhanced-chat/groups/:chatId/leave',
  'DELETE /api/enhanced-chat/groups/:chatId/members/:userId',
  'POST /api/chat/chat',
  'POST /api/chat/send-message',
  'POST /api/enhanced-chat/send-message',
];

describe('ChatController route parity', () => {
  it('owns exactly the eighteen core chat routes', () => {
    const controller = new ChatController({} as never);
    expect(routesOf(controller)).toEqual(new Set(expected));
  });
});
