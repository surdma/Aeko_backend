import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { SessionGuard } from '../../auth/guards/session/session.guard';
import type { ProcessedMedia } from './image-processor.port';
import {
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  MediaProcessingService,
} from './media-processing.service';

/**
 * The legacy `/api/photo/edit` and `/api/video/edit` routes were mounted with
 * no authentication middleware at all, so anonymous callers could spend CPU,
 * memory, and disk. Both now require a session.
 */
@Controller()
@UseGuards(SessionGuard)
export class MediaProcessingController {
  constructor(private readonly processing: MediaProcessingService) {}

  @Post('api/photo/edit')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('photo', { limits: { fileSize: MAX_IMAGE_BYTES } }),
  )
  editPhoto(
    @UploadedFile() file: unknown,
    @Body() body: unknown,
  ): Promise<ProcessedMedia> {
    return this.processing.editPhoto(file, body);
  }

  @Post('api/video/edit')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('video', { limits: { fileSize: MAX_VIDEO_BYTES } }),
  )
  editVideo(
    @UploadedFile() file: unknown,
    @Body() body: unknown,
  ): Promise<ProcessedMedia> {
    return this.processing.editVideo(file, body);
  }
}
