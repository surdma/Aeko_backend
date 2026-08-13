/* eslint-disable @typescript-eslint/require-await -- async test double implements authorization port */
import { LegacyBase64MediaAdapter } from '../../src/chat/media/legacy-base64-media.adapter';
import { ChatAttachmentService } from '../../src/chat/media/chat-attachment.service';
describe('chat media', () => {
  it('bounds legacy base64 payloads', () => {
    expect(() =>
      new LegacyBase64MediaAdapter().decode(
        `data:audio/webm;base64,${Buffer.alloc(1024 * 1024 + 1).toString('base64')}`,
      ),
    ).toThrow();
  });
  it('rejects declared mime that does not match bytes before provider upload', async () => {
    const uploadChatAttachment = jest.fn();
    const service = new ChatAttachmentService(
      { uploadChatAttachment } as never,
      { assertMember: async () => undefined } as never,
    );
    await expect(
      service.upload({
        ownerId: 'u',
        chatId: 'c',
        bytes: Uint8Array.from([0, 1, 2]),
        declaredMimeType: 'image/png',
        filename: 'x.exe',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(uploadChatAttachment).not.toHaveBeenCalled();
  });
});
