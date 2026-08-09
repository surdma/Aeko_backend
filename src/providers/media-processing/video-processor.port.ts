import type { ProcessedMedia } from './image-processor.port';
import type { VideoEffect } from './media-processing.contract';

export type ProcessableVideoMimeType = 'video/mp4' | 'video/quicktime';

export interface ProcessVideoInput {
  readonly bytes: Uint8Array;
  readonly mimeType: ProcessableVideoMimeType;
  readonly effect: VideoEffect;
}

export abstract class VideoProcessorPort {
  abstract process(input: ProcessVideoInput): Promise<ProcessedMedia>;
}
