import { Body, Controller, Get, Post, Put, Query, Req } from '@nestjs/common';
import type { AuthenticatedPrincipal } from '../../auth/auth.types';
import { BotService } from './bot.service';
interface R {
  user: AuthenticatedPrincipal;
}
type I = Readonly<Record<string, unknown>>;
@Controller()
export class BotController {
  constructor(private readonly bot: BotService) {}
  private run(r: R, o: string, i: I = {}) {
    return this.bot.execute(r.user, o, i);
  }
  @Post('api/enhanced-bot/chat') chat(@Req() r: R, @Body() b: unknown) {
    return this.bot.chat(r.user, b);
  }
  @Get('api/enhanced-bot/settings') settings(@Req() r: R) {
    return this.run(r, 'settings');
  }
  @Put('api/enhanced-bot/settings') update(@Req() r: R, @Body() b: I) {
    return this.run(r, 'updateSettings', b);
  }
  @Get('api/enhanced-bot/personalities') personalities(@Req() r: R) {
    return this.run(r, 'personalities');
  }
  @Get('api/enhanced-bot/conversation-history') history(
    @Req() r: R,
    @Query() q: I,
  ) {
    return this.run(r, 'history', q);
  }
  @Get('api/enhanced-bot/analytics') analytics(@Req() r: R) {
    return this.run(r, 'analytics');
  }
  @Post('api/enhanced-bot/generate-image') image(@Req() r: R, @Body() b: I) {
    return this.run(r, 'generateImage', b);
  }
  @Post('api/enhanced-bot/summarize-conversation') summary(
    @Req() r: R,
    @Body() b: I,
  ) {
    return this.run(r, 'summarize', b);
  }
  @Post('api/enhanced-bot/rate-response') rate(@Req() r: R, @Body() b: I) {
    return this.run(r, 'rate', b);
  }
  @Put('api/bot/bot-settings') legacy(@Req() r: R, @Body() b: I) {
    return this.run(r, 'legacySettings', b);
  }
  @Post('api/enhanced-chat/assist') assist(@Req() r: R, @Body() b: I) {
    return this.run(r, 'assist', b);
  }
  @Post('api/enhanced-chat/bot-chat') botChat(@Req() r: R, @Body() b: unknown) {
    return this.bot.chat(r.user, b);
  }
}
