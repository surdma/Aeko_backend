import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import type { AuthenticatedPrincipal } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user/current-user.decorator';
import { SessionGuard } from '../auth/guards/session/session.guard';
import type { JsonValue } from '../common/json/json-value';
import { CommunityProfilesService } from './community-profiles.service';
import type {
  CommunityPostPage,
  CommunityPostView,
} from './community-profile.contract';

/** Legacy accepted the image under the `photo` field, in memory. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

@Controller('api/community-profiles')
@UseGuards(SessionGuard)
export class CommunityProfilesController {
  constructor(private readonly profiles: CommunityProfilesService) {}

  @Put(':id/profile')
  updateProfile(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ readonly success: true; readonly data: JsonValue }> {
    return this.profiles.updateProfile(principal, id, body);
  }

  @Post(':id/upload-photo')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('photo', { limits: { fileSize: MAX_IMAGE_BYTES } }),
  )
  uploadPhoto(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Query() query: unknown,
    @UploadedFile() file: unknown,
  ): Promise<{
    readonly success: true;
    readonly data: JsonValue;
    readonly message: string;
  }> {
    return this.profiles.uploadPhoto(principal, id, query, file);
  }

  @Put(':id/settings')
  updateSettings(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{ readonly success: true; readonly data: JsonValue }> {
    return this.profiles.updateSettings(principal, id, body);
  }

  @Post(':id/follow')
  @HttpCode(HttpStatus.OK)
  follow(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
  ): Promise<{ readonly success: true; readonly message: string }> {
    return this.profiles.follow(principal, id);
  }

  @Post(':id/unfollow')
  @HttpCode(HttpStatus.OK)
  unfollow(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
  ): Promise<{ readonly success: true; readonly message: string }> {
    return this.profiles.unfollow(principal, id);
  }

  @Post(':id/posts')
  @HttpCode(HttpStatus.CREATED)
  createPost(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<{
    readonly success: true;
    readonly data: CommunityPostView;
    readonly message: string;
  }> {
    return this.profiles.createPost(principal, id, body);
  }

  @Get(':id/posts')
  listPosts(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Query() query: unknown,
  ): Promise<CommunityPostPage> {
    return this.profiles.listPosts(principal, id, query);
  }
}
