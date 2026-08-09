import { Module } from '@nestjs/common';
import { MediaProcessingController } from './media-processing.controller';
import { MediaProcessingService } from './media-processing.service';

@Module({
  controllers: [MediaProcessingController],
  providers: [MediaProcessingService],
})
export class MediaProcessingModule {}
