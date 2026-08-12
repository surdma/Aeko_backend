import { Injectable } from '@nestjs/common';
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
    const detected = detectMime(input.bytes);
    if (detected !== input.declaredMimeType) throw new DomainError('VALIDATION_FAILED', 'Attachment type does not match its content');
    const filename = input.filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 255);
    const uploaded = await this.media.uploadChatAttachment({ ...input, filename });
    return { ...uploaded, chatId: input.chatId, filename, mimeType: input.declaredMimeType, size: input.bytes.byteLength };
  }
}

const starts = (bytes: Uint8Array, signature: readonly number[]): boolean =>
  signature.every((value, index) => bytes[index] === value);
const ascii = (bytes: Uint8Array, offset: number, value: string): boolean =>
  [...value].every((character, index) => bytes[offset + index] === character.charCodeAt(0));
const detectMime = (bytes: Uint8Array): string | null => {
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) return 'image/webp';
  if (starts(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return 'audio/webm';
  if (starts(bytes, [0x49, 0x44, 0x33]) || (bytes[0] === 0xff && (bytes[1] ?? 0) >= 0xe0)) return 'audio/mpeg';
  if (ascii(bytes, 4, 'ftyp')) return 'video/mp4';
  if (ascii(bytes, 0, '%PDF-')) return 'application/pdf';
  return null;
};
