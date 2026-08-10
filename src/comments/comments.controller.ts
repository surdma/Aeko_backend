import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import type { AuthenticatedPrincipal } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user/current-user.decorator';
import { SessionGuard } from '../auth/guards/session/session.guard';
import { parseCommentListQuery, type CommentView } from './comment.contract';
import { CommentsService, type CommentCreateResult } from './comments.service';

@Controller('api/comments')
@UseGuards(SessionGuard)
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Post('reply/:commentId')
  @HttpCode(HttpStatus.CREATED)
  reply(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('commentId') commentId: string,
    @Body() body: unknown,
  ): Promise<CommentView> {
    return this.comments.reply(principal, commentId, body);
  }

  @Post('like/:commentId')
  @HttpCode(HttpStatus.OK)
  like(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('commentId') commentId: string,
  ): Promise<CommentView> {
    return this.comments.like(principal, commentId);
  }

  // Declared before `:postId` so the literal reply path is reachable.
  @Get('replies/:commentId')
  listReplies(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('commentId') commentId: string,
    @Query() query: unknown,
  ): Promise<readonly CommentView[]> {
    return this.comments.listReplies(
      principal,
      commentId,
      parseCommentListQuery(query),
    );
  }

  @Post(':postId')
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('postId') postId: string,
    @Body() body: unknown,
  ): Promise<CommentCreateResult> {
    return this.comments.create(principal, postId, body);
  }

  @Get(':postId')
  listForPost(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('postId') postId: string,
    @Query() query: unknown,
  ): Promise<readonly CommentView[]> {
    return this.comments.listForPost(
      principal,
      postId,
      parseCommentListQuery(query),
    );
  }
}
