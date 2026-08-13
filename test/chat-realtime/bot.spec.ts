/* eslint-disable @typescript-eslint/require-await -- async test double implements provider port */
import { BotService } from '../../src/chat/bot/bot.service';
describe('BotService', () => {
  it('does not rewrite safe provider errors', async () => {
    const bot = new BotService(
      {
        reply: async () => {
          throw Object.assign(
            new Error('AI service is temporarily unavailable'),
            { code: 'PROVIDER_UNAVAILABLE' },
          );
        },
      } as never,
      {} as never,
    );
    await expect(
      bot.chat({ userId: 'u' } as never, { message: 'hi' }),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });
});
