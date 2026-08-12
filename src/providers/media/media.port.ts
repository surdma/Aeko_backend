export type MediaPurpose = 'profile' | 'cover';
export type ImageMimeType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface UploadImageInput {
  readonly ownerId: string;
  readonly purpose: MediaPurpose;
  readonly bytes: Uint8Array;
  readonly mimeType: ImageMimeType;
}

export interface UploadedMedia {
  readonly url: string;
  readonly providerId: string;
}
export interface UploadAttachmentInput {
  readonly ownerId: string; readonly chatId: string; readonly bytes: Uint8Array;
  readonly declaredMimeType: string; readonly filename: string;
}

export abstract class MediaPort {
  abstract uploadProfileImage(input: UploadImageInput): Promise<UploadedMedia>;
  abstract deleteProfileImage(providerId: string): Promise<void>;
  abstract uploadChatAttachment(input: UploadAttachmentInput): Promise<UploadedMedia>;
}
