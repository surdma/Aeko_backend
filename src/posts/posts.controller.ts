import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';

import type { AuthenticatedPrincipal } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user/current-user.decorator';
import { SessionGuard } from '../auth/guards/session/session.guard';
import type { PostView } from './post.contract';
import { PostsService } from './posts.service';

const MAX_MEDIA_FILES = 10;
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;

@Controller('api/posts')
@UseGuards(SessionGuard)
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Post('create')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FilesInterceptor('media', MAX_MEDIA_FILES, {
      limits: { fileSize: MAX_MEDIA_BYTES },
    }),
  )
  create(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() body: unknown,
    @UploadedFiles() files: unknown,
  ): Promise<PostView> {
    return this.posts.create(principal, body, readUploadPaths(files));
  }

  @Put(':postId')
  update(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('postId') postId: string,
    @Body() body: unknown,
  ): Promise<PostView> {
    return this.posts.update(principal, postId, body);
  }

  @Put(':postId/privacy')
  setPrivacy(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('postId') postId: string,
    @Body() body: unknown,
  ): Promise<PostView> {
    return this.posts.setPrivacy(principal, postId, body);
  }

  @Delete(':id')
  remove(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
  ): Promise<{ readonly deleted: true }> {
    return this.posts.remove(principal, id);
  }
}

const readUploadPaths = (files: unknown): readonly string[] => {
  if (!Array.isArray(files)) return [];
  return files.flatMap((file: unknown) => {
    if (typeof file !== 'object' || file === null) return [];
    const path: unknown = Reflect.get(file, 'path');
    return typeof path === 'string' && path.length > 0 ? [path] : [];
  });
};
