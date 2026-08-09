import { Injectable } from '@nestjs/common';

import { DomainError } from '../../common/errors/domain.error';
import {
  ImageProcessorPort,
  type ProcessableImageMimeType,
  type ProcessedMedia,
} from './image-processor.port';
import {
  parseImageEffect,
  parseVideoEffect,
} from './media-processing.contract';
import {
  VideoProcessorPort,
  type ProcessableVideoMimeType,
} from './video-processor.port';

const MEBIBYTE = 1024 * 1024;
export const MAX_IMAGE_BYTES = 10 * MEBIBYTE;
export const MAX_VIDEO_BYTES = 100 * MEBIBYTE;

/**
 * Declared content types are attacker-controlled, so each one is paired with
 * the magic bytes that must appear at the head of the upload.
 */
const IMAGE_SIGNATURES: Readonly<
  Record<ProcessableImageMimeType, readonly (readonly number[])[]>
> = {
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  'image/webp': [[0x52, 0x49, 0x46, 0x46]],
};

const VIDEO_SIGNATURES: Readonly<
  Record<ProcessableVideoMimeType, readonly (readonly number[])[]>
> = {
  // ISO base media files carry `ftyp` at byte four; the leading size varies.
  'video/mp4': [[0x66, 0x74, 0x79, 0x70]],
  'video/quicktime': [[0x66, 0x74, 0x79, 0x70]],
};

const IMAGE_SIGNATURE_OFFSET = 0;
const VIDEO_SIGNATURE_OFFSET = 4;

interface UploadedFile {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
}

@Injectable()
export class MediaProcessingService {
  constructor(
    private readonly images: ImageProcessorPort,
    private readonly videos: VideoProcessorPort,
  ) {}

  async editPhoto(value: unknown, body: unknown): Promise<ProcessedMedia> {
    const request = parseImageEffect(body);
    const file = readUpload(value, MAX_IMAGE_BYTES, 'photo');
    const mimeType = requireImageType(file);
    try {
      return await this.images.process({
        bytes: file.bytes,
        mimeType,
        effect: request.effect,
      });
    } catch (error: unknown) {
      throw sanitize(error, 'Image processing is unavailable.');
    }
  }

  async editVideo(value: unknown, body: unknown): Promise<ProcessedMedia> {
    const request = parseVideoEffect(body);
    const file = readUpload(value, MAX_VIDEO_BYTES, 'video');
    const mimeType = requireVideoType(file);
    try {
      return await this.videos.process({
        bytes: file.bytes,
        mimeType,
        effect: request.effect,
      });
    } catch (error: unknown) {
      throw sanitize(error, 'Video processing is unavailable.');
    }
  }
}

/**
 * Provider messages carry absolute paths and library internals, so only a
 * fixed message is ever surfaced. A DomainError raised deliberately by an
 * adapter is already safe and passes through unchanged.
 */
const sanitize = (error: unknown, message: string): DomainError =>
  error instanceof DomainError
    ? error
    : new DomainError('PROVIDER_UNAVAILABLE', message);

const readUpload = (
  value: unknown,
  maximumBytes: number,
  field: string,
): UploadedFile => {
  if (typeof value !== 'object' || value === null) {
    throw invalidUpload(field, 'A file is required.');
  }
  const buffer: unknown = Reflect.get(value, 'buffer');
  const bytes = toBytes(buffer);
  if (bytes === null || bytes.byteLength === 0) {
    throw invalidUpload(field, 'A file is required.');
  }
  if (bytes.byteLength > maximumBytes) {
    throw invalidUpload(
      field,
      `The file must be ${Math.floor(maximumBytes / MEBIBYTE)} MB or smaller.`,
    );
  }
  const mimeType: unknown = Reflect.get(value, 'mimetype');
  return {
    bytes,
    mimeType: typeof mimeType === 'string' ? mimeType : '',
  };
};

const toBytes = (value: unknown): Uint8Array | null =>
  value instanceof Uint8Array ? value : null;

const requireImageType = (file: UploadedFile): ProcessableImageMimeType => {
  const mimeType = Object.keys(IMAGE_SIGNATURES).find(
    (candidate) => candidate === file.mimeType,
  );
  if (mimeType === undefined || !isImageMimeType(mimeType)) {
    throw invalidUpload('photo', 'Upload a JPEG, PNG, or WebP image.');
  }
  requireSignature(
    file.bytes,
    IMAGE_SIGNATURES[mimeType],
    IMAGE_SIGNATURE_OFFSET,
    'photo',
    'The file contents do not match an image.',
  );
  return mimeType;
};

const requireVideoType = (file: UploadedFile): ProcessableVideoMimeType => {
  const mimeType = Object.keys(VIDEO_SIGNATURES).find(
    (candidate) => candidate === file.mimeType,
  );
  if (mimeType === undefined || !isVideoMimeType(mimeType)) {
    throw invalidUpload('video', 'Upload an MP4 or QuickTime video.');
  }
  requireSignature(
    file.bytes,
    VIDEO_SIGNATURES[mimeType],
    VIDEO_SIGNATURE_OFFSET,
    'video',
    'The file contents do not match a video.',
  );
  return mimeType;
};

const isImageMimeType = (value: string): value is ProcessableImageMimeType =>
  Object.prototype.hasOwnProperty.call(IMAGE_SIGNATURES, value);

const isVideoMimeType = (value: string): value is ProcessableVideoMimeType =>
  Object.prototype.hasOwnProperty.call(VIDEO_SIGNATURES, value);

const requireSignature = (
  bytes: Uint8Array,
  signatures: readonly (readonly number[])[],
  offset: number,
  field: string,
  message: string,
): void => {
  const matched = signatures.some((signature) =>
    signature.every((byte, index) => bytes[offset + index] === byte),
  );
  if (!matched) throw invalidUpload(field, message);
};

const invalidUpload = (field: string, message: string): DomainError =>
  new DomainError('VALIDATION_FAILED', message, { [field]: [message] });
