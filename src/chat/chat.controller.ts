import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { AuthenticatedPrincipal } from '../auth/auth.types';
import { parseSendMessage } from './chat.contract';
import { ChatService, type CoreChatOperation } from './chat.service';

interface AuthenticatedRequest {
  readonly user: AuthenticatedPrincipal;
}
type Input = Readonly<Record<string, unknown>>;

@Controller()
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  private run(
    operation: CoreChatOperation,
    request: AuthenticatedRequest,
    input: Input = {},
  ) {
    return this.chat.execute(operation, request.user, input);
  }

  @Get('api/enhanced-chat/conversations') conversations(
    @Req() r: AuthenticatedRequest,
    @Query() q: Input,
  ) {
    return this.run('listConversations', r, q);
  }
  @Delete('api/enhanced-chat/conversations/:chatId') deleteConversation(
    @Req() r: AuthenticatedRequest,
    @Param() p: Input,
  ) {
    return this.run('deleteConversation', r, p);
  }
  @Get('api/enhanced-chat/messages/:chatId') messages(
    @Req() r: AuthenticatedRequest,
    @Param() p: Input,
    @Query() q: Input,
  ) {
    return this.run('listMessages', r, { ...p, ...q });
  }
  @Delete('api/enhanced-chat/messages/:messageId') deleteMessage(
    @Req() r: AuthenticatedRequest,
    @Param() p: Input,
  ) {
    return this.run('deleteMessage', r, p);
  }
  @Get('api/enhanced-chat/search') search(
    @Req() r: AuthenticatedRequest,
    @Query() q: Input,
  ) {
    return this.run('searchMessages', r, q);
  }
  @Post('api/enhanced-chat/emoji-reactions/:messageId') addReaction(
    @Req() r: AuthenticatedRequest,
    @Param() p: Input,
    @Body() b: Input,
  ) {
    return this.run('addReaction', r, { ...p, ...b });
  }
  @Delete('api/enhanced-chat/emoji-reactions/:messageId') removeReaction(
    @Req() r: AuthenticatedRequest,
    @Param() p: Input,
    @Query() q: Input,
  ) {
    return this.run('removeReaction', r, { ...p, ...q });
  }
  @Post('api/enhanced-chat/mark-read/:chatId') markRead(
    @Req() r: AuthenticatedRequest,
    @Param() p: Input,
  ) {
    return this.run('markRead', r, p);
  }
  @Get('api/enhanced-chat/emoji-list') emojis(@Req() r: AuthenticatedRequest) {
    return this.run('listEmojis', r);
  }
  @Get('api/enhanced-chat/users') users(
    @Req() r: AuthenticatedRequest,
    @Query() q: Input,
  ) {
    return this.run('listUsers', r, q);
  }
  @Post('api/enhanced-chat/create-chat') createChat(
    @Req() r: AuthenticatedRequest,
    @Body() b: Input,
  ) {
    return this.run('createChat', r, b);
  }
  @Get('api/enhanced-chat/groups/:chatId/invite') invite(
    @Req() r: AuthenticatedRequest,
    @Param() p: Input,
  ) {
    return this.run('getInvite', r, p);
  }
  @Post('api/enhanced-chat/groups/join/:inviteCode') join(
    @Req() r: AuthenticatedRequest,
    @Param() p: Input,
  ) {
    return this.run('joinGroup', r, p);
  }
  @Delete('api/enhanced-chat/groups/:chatId/leave') leave(
    @Req() r: AuthenticatedRequest,
    @Param() p: Input,
  ) {
    return this.run('leaveGroup', r, p);
  }
  @Delete('api/enhanced-chat/groups/:chatId/members/:userId') removeMember(
    @Req() r: AuthenticatedRequest,
    @Param() p: Input,
  ) {
    return this.run('removeGroupMember', r, p);
  }
  @Post('api/chat/chat') legacyChat(
    @Req() r: AuthenticatedRequest,
    @Body() b: Input,
  ) {
    return this.run('legacyChat', r, b);
  }
  @Post('api/chat/send-message') legacySend(
    @Req() r: AuthenticatedRequest,
    @Body() b: Input,
  ) {
    return this.run('legacySendMessage', r, b);
  }
  @Post('api/enhanced-chat/send-message') send(
    @Req() r: AuthenticatedRequest,
    @Body() b: unknown,
  ) {
    return this.chat.sendMessage(r.user, parseSendMessage(b));
  }
}
