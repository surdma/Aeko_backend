import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';

import type { AuthenticatedPrincipal } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user/current-user.decorator';
import { SessionGuard } from '../auth/guards/session/session.guard';
import {
  parsePostListQuery,
  parsePostSearchQuery,
  type PostPage,
  type PostView,
} from './post.contract';
import {
  PostsService,
  type BookmarkResult,
  type LikeResult,
  type SharedStatusView,
} from './posts.service';

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

  // Every literal path is declared before `:postId`. In Express `/mixed` and
  // `/videos` were declared after it and were therefore unreachable.
  @Get('feed')
  feed(
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<readonly PostView[]> {
    return this.posts.feed(principal);
  }

  @Get('search')
  search(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: unknown,
  ): Promise<readonly PostView[]> {
    return this.posts.search(principal, parsePostSearchQuery(query));
  }

  @Get('mixed')
  mixed(
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<readonly PostView[]> {
    return this.posts.mixed(principal);
  }

  @Get('videos')
  videos(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query('effect') effect?: string,
  ): Promise<readonly PostView[]> {
    return this.posts.videos(principal, { effect });
  }

  @Get('user/bookmarks')
  bookmarks(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: unknown,
  ): Promise<PostPage> {
    return this.posts.bookmarks(principal, parsePostListQuery(query));
  }

  @Get('user/liked')
  liked(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: unknown,
  ): Promise<PostPage> {
    return this.posts.liked(principal, parsePostListQuery(query));
  }

  @Get('user/:userId')
  byUser(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('userId') userId: string,
    @Query() query: unknown,
  ): Promise<PostPage> {
    return this.posts.byUser(principal, userId, parsePostListQuery(query));
  }

  @Get(':postId/reposts')
  reposts(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('postId') postId: string,
  ): Promise<readonly PostView[]> {
    return this.posts.reposts(principal, postId);
  }

  @Get(':postId')
  byId(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('postId') postId: string,
  ): Promise<PostView> {
    return this.posts.byId(principal, postId);
  }

  @Post(':postId/like')
  @HttpCode(HttpStatus.OK)
  like(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('postId') postId: string,
  ): Promise<LikeResult> {
    return this.posts.like(principal, postId);
  }

  @Post(':postId/bookmark')
  @HttpCode(HttpStatus.OK)
  bookmark(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('postId') postId: string,
  ): Promise<BookmarkResult> {
    return this.posts.bookmark(principal, postId);
  }

  @Post(':postId/view')
  @HttpCode(HttpStatus.OK)
  view(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('postId') postId: string,
  ): Promise<{ readonly success: true; readonly views: number }> {
    return this.posts.view(principal, postId);
  }

  @Post(':postId/not-interested')
  @HttpCode(HttpStatus.OK)
  notInterested(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('postId') postId: string,
  ): Promise<{ readonly success: true; readonly message: string }> {
    return this.posts.notInterested(principal, postId);
  }

  @Post(':postId/share-to-status')
  @HttpCode(HttpStatus.CREATED)
  shareToStatus(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('postId') postId: string,
    @Body() body: unknown,
  ): Promise<SharedStatusView> {
    return this.posts.shareToStatus(principal, postId, body);
  }

  @Post(':postId/promote')
  @HttpCode(HttpStatus.OK)
  promote(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('postId') postId: string,
    @Body() body: unknown,
  ): Promise<PostView> {
    return this.posts.promote(principal, postId, body);
  }

  @Post('repost/:postId')
  @HttpCode(HttpStatus.CREATED)
  repost(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('postId') postId: string,
  ): Promise<PostView> {
    return this.posts.repost(principal, postId);
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
