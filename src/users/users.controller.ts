import {
  Controller,
  Delete,
  Get,
  Param,
  Query,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../auth/decorators/current-user/current-user.decorator';
import { SessionGuard } from '../auth/guards/session/session.guard';
import { TwoFactorGuard } from '../auth/guards/two-factor/two-factor.guard';
import type { AuthenticatedPrincipal } from '../auth/auth.types';
import { parsePageQuery } from '../common/pagination/page-query';
import { parseUserSearch, type UserPage, type UserView } from './user.contract';
import { UsersService } from './users.service';

@Controller('api/users')
@UseGuards(SessionGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Put('profile-picture')
  @UseGuards(SessionGuard, TwoFactorGuard)
  @UseInterceptors(
    FileInterceptor('image', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  updateProfilePicture(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @UploadedFile() file: unknown,
  ): Promise<{ readonly profilePicture: string }> {
    return this.users.updateProfilePicture(principal, file);
  }

  @Put('cover-picture')
  @UseGuards(SessionGuard, TwoFactorGuard)
  @UseInterceptors(
    FileInterceptor('image', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  updateCoverPicture(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @UploadedFile() file: unknown,
  ): Promise<{ readonly coverPicture: string }> {
    return this.users.updateCoverPicture(principal, file);
  }

  @Get()
  list(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: unknown,
  ): Promise<UserPage> {
    return this.users.listUsers(principal.userId, {
      ...parsePageQuery(query),
      ...parseUserSearch(query),
    });
  }

  @Get(':id')
  getUser(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
  ): Promise<UserView> {
    return this.users.getUser(principal.userId, id);
  }

  @Get(':id/followers')
  followers(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Query() query: unknown,
  ): Promise<UserPage> {
    return this.users.followers(principal.userId, id, parsePageQuery(query));
  }

  @Get(':id/following')
  following(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Query() query: unknown,
  ): Promise<UserPage> {
    return this.users.following(principal.userId, id, parsePageQuery(query));
  }

  @Delete(':id')
  deleteUser(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
  ): Promise<{ readonly deleted: true }> {
    return this.users.deleteUser(principal, id);
  }
}
