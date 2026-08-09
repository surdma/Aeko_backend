import { Module } from '@nestjs/common';
import { CloudinaryMediaAdapter } from './cloudinary-media.adapter';
import { MediaPort } from './media.port';

@Module({
  providers: [{ provide: MediaPort, useClass: CloudinaryMediaAdapter }],
  exports: [MediaPort],
})
export class MediaModule {}
