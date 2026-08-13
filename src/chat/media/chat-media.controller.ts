import {
  Body,
  Controller,
  Param,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { AuthenticatedPrincipal } from '../../auth/auth.types';
import { ChatAttachmentService } from './chat-attachment.service';
interface Request {
  user: AuthenticatedPrincipal;
}
interface MemoryFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}
@Controller('api/enhanced-chat')
export class ChatMediaController {
  constructor(private readonly attachments: ChatAttachmentService) {}
  @Post('upload-file')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 100 * 1024 * 1024, files: 1 },
    }),
  )
  upload(
    @Req() r: Request,
    @Body('chatId') chatId: string,
    @UploadedFile() file: MemoryFile,
  ) {
    return this.attachments.upload({
      ownerId: r.user.userId,
      chatId,
      bytes: file.buffer,
      declaredMimeType: file.mimetype,
      filename: file.originalname,
    });
  }
  @Post('upload-voice')
  @UseInterceptors(
    FileInterceptor('voice', {
      limits: { fileSize: 25 * 1024 * 1024, files: 1 },
    }),
  )
  voice(
    @Req() r: Request,
    @Body('chatId') chatId: string,
    @UploadedFile() file: MemoryFile,
  ) {
    return this.attachments.upload({
      ownerId: r.user.userId,
      chatId,
      bytes: file.buffer,
      declaredMimeType: file.mimetype,
      filename: file.originalname,
    });
  }
  @Post('groups/:chatId/icon')
  @UseInterceptors(
    FileInterceptor('icon', {
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    }),
  )
  icon(
    @Req() r: Request,
    @Param('chatId') chatId: string,
    @UploadedFile() file: MemoryFile,
  ) {
    return this.attachments.upload({
      ownerId: r.user.userId,
      chatId,
      bytes: file.buffer,
      declaredMimeType: file.mimetype,
      filename: file.originalname,
    });
  }
}
