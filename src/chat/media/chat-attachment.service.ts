import { Injectable } from '@nestjs/common';
import { fileTypeFromBuffer } from 'file-type';
import { DomainError } from '../../common/errors/domain.error';
import { MediaPort } from '../../providers/media/media.port';
import { ChatAuthorizationService } from '../chat-authorization.service';

const ALLOWED = new Set(['image/jpeg','image/png','image/webp','audio/webm','audio/mpeg','video/mp4','application/pdf']);
const MAX_BYTES = 100 * 1024 * 1024;
export interface ChatUpload { ownerId: string; chatId: string; bytes: Uint8Array; declaredMimeType: string; filename: string }
@Injectable()
export class ChatAttachmentService {
  constructor(private readonly media: MediaPort, private readonly authorization: ChatAuthorizationService) {}
  async upload(input: ChatUpload) {
    await this.authorization.assertMember(input.ownerId, input.chatId);
    if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_BYTES || !ALLOWED.has(input.declaredMimeType)) throw new DomainError('VALIDATION_FAILED', 'Unsupported attachment');
    const detected = await fileTypeFromBuffer(input.bytes);
    if (detected?.mime !== input.declaredMimeType) throw new DomainError('VALIDATION_FAILED', 'Attachment type does not match its content');
    const filename = input.filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 255);
    const uploaded = await this.media.uploadChatAttachment({ ...input, filename });
    return { ...uploaded, chatId: input.chatId, filename, mimeType: input.declaredMimeType, size: input.bytes.byteLength };
  }
}
