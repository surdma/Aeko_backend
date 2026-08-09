import type { ImageEffect } from './media-processing.contract';

export type ProcessableImageMimeType =
  'image/jpeg' | 'image/png' | 'image/webp';

export interface ProcessImageInput {
  readonly bytes: Uint8Array;
  readonly mimeType: ProcessableImageMimeType;
  readonly effect: ImageEffect;
}

export interface ProcessedMedia {
  readonly url: string;
}

export abstract class ImageProcessorPort {
  abstract process(input: ProcessImageInput): Promise<ProcessedMedia>;
}
