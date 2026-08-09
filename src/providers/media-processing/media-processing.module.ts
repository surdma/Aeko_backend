import { Module } from '@nestjs/common';

import { AuthModule } from '../../auth/auth.module';
import { FfmpegVideoAdapter } from './ffmpeg-video.adapter';
import { ImageProcessorPort } from './image-processor.port';
import { MediaProcessingController } from './media-processing.controller';
import { MediaProcessingService } from './media-processing.service';
import { SharpImageAdapter } from './sharp-image.adapter';
import { VideoProcessorPort } from './video-processor.port';

@Module({
  imports: [AuthModule],
  controllers: [MediaProcessingController],
  providers: [
    MediaProcessingService,
    { provide: ImageProcessorPort, useClass: SharpImageAdapter },
    { provide: VideoProcessorPort, useClass: FfmpegVideoAdapter },
  ],
})
export class MediaProcessingModule {}
