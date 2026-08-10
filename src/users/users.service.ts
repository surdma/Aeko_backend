import { Injectable } from '@nestjs/common';
import type { AuthenticatedPrincipal } from '../auth/auth.types';
import { DomainError } from '../common/errors/domain.error';
import {
  createPageMeta,
  type PageQuery,
} from '../common/pagination/page-query';
import { PrismaService } from '../database/prisma/prisma.service';
import {
  MediaPort,
  type ImageMimeType,
  type MediaPurpose,
  type UploadedMedia,
} from '../providers/media/media.port';
import {
  projectUser,
  type UserListQuery,
  type UserPage,
  type UserView,
} from './user.contract';
import {
  createUserPrismaClient,
  type UserPrismaClient,
  type UserRecord,
} from './user-prisma.client';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaPort,
  ) {}

  private get users(): UserPrismaClient {
    return createUserPrismaClient(this.prisma.db);
  }

  updateProfilePicture(
    principal: AuthenticatedPrincipal,
    file: unknown,
  ): Promise<{ readonly profilePicture: string }> {
    return this.updatePicture(principal.userId, 'profile', file).then(
      (profilePicture) => ({ profilePicture }),
    );
  }

  updateCoverPicture(
    principal: AuthenticatedPrincipal,
    file: unknown,
  ): Promise<{ readonly coverPicture: string }> {
    return this.updatePicture(principal.userId, 'cover', file).then(
      (coverPicture) => ({ coverPicture }),
    );
  }

  private async updatePicture(
    ownerId: string,
    purpose: MediaPurpose,
    value: unknown,
  ): Promise<string> {
    const file = parseImageFile(value);
    let uploaded: UploadedMedia;
    try {
      uploaded = await this.media.uploadProfileImage({
        ownerId,
        purpose,
        bytes: file.bytes,
        mimeType: file.mimeType,
      });
    } catch (error: unknown) {
      if (
        error instanceof DomainError &&
        error.code === 'PROVIDER_UNAVAILABLE' &&
        error.message === 'Media uploads are not configured.'
      ) {
        throw error;
      }
      throw new DomainError(
        'PROVIDER_UNAVAILABLE',
        'The media provider is temporarily unavailable.',
      );
    }
    const expectedProviderId = `aeko/users/${encodeURIComponent(ownerId)}/${purpose}`;
    if (
      !isHttpsUrl(uploaded.url) ||
      uploaded.providerId !== expectedProviderId
    ) {
      throw new DomainError(
        'PROVIDER_UNAVAILABLE',
        'The media provider is temporarily unavailable.',
      );
    }
    try {
      return await this.users.updatePicture(ownerId, purpose, uploaded.url);
    } catch (databaseError: unknown) {
      await this.cleanupUploadedMedia(uploaded.providerId);
      if (isPrismaNotFound(databaseError)) {
        throw new DomainError('NOT_FOUND', 'User not found.');
      }
      if (databaseError instanceof DomainError) throw databaseError;
      throw new DomainError(
        'INTERNAL_ERROR',
        'The profile picture could not be saved.',
      );
    }
  }

  private async cleanupUploadedMedia(providerId: string): Promise<void> {
    try {
      await this.media.deleteProfileImage(providerId);
    } catch {
      // Cleanup is best-effort; the original sanitized database error remains
      // authoritative and the reconciliation gate handles residual orphans.
    }
  }

  async getUser(viewerId: string, targetId: string): Promise<UserView> {
    const { target } = await this.visibleTarget(viewerId, targetId);
    // Legacy post/bookmark/likes enrichment belongs to the downstream content
    // domain integration gate. This slice returns only the safe user projection.
    return this.projectVisibleUser(target, true);
  }

  async listUsers(viewerId: string, query: UserListQuery): Promise<UserPage> {
    const skip = (query.page - 1) * query.limit;
    const [total, records, viewer] = await Promise.all([
      this.users.count(query.search),
      this.users.findMany({
        search: query.search,
        skip,
        take: query.limit,
      }),
      this.users.findUnique(viewerId),
    ]);
    const visible: UserView[] = [];
    for (const record of records) {
      if (!this.isMutuallyBlocked(viewerId, record, viewer)) {
        visible.push(this.projectVisibleUser(record, false));
      }
    }
    return { items: visible, page: createPageMeta(query, total) };
  }

  followers(
    viewerId: string,
    targetId: string,
    query: PageQuery,
  ): Promise<UserPage> {
    return this.graphPage('followers', viewerId, targetId, query);
  }

  following(
    viewerId: string,
    targetId: string,
    query: PageQuery,
  ): Promise<UserPage> {
    return this.graphPage('following', viewerId, targetId, query);
  }

  async deleteUser(
    principal: AuthenticatedPrincipal,
    targetId: string,
  ): Promise<{ readonly deleted: true }> {
    if (principal.userId !== targetId && !principal.isAdmin) {
      throw new DomainError(
        'AUTHORIZATION_DENIED',
        'You are not allowed to delete this account.',
      );
    }
    if (!principal.twoFactorSatisfied) {
      throw new DomainError(
        'TWO_FACTOR_REQUIRED',
        'Two-factor authentication is required.',
      );
    }
    if (!(await this.users.findUnique(targetId))) {
      throw new DomainError('NOT_FOUND', 'User not found.');
    }
    await this.users.deleteInTransaction(targetId);
    return { deleted: true };
  }

  private async graphPage(
    field: 'followers' | 'following',
    viewerId: string,
    targetId: string,
    query: PageQuery,
  ): Promise<UserPage> {
    const { target, viewer } = await this.visibleTarget(viewerId, targetId);
    this.assertPrivateAccess(viewerId, target);
    const ids = parseIdList(target[field], field);
    const start = (query.page - 1) * query.limit;
    const pageIds = ids.slice(start, start + query.limit);
    const records =
      pageIds.length === 0
        ? []
        : await this.users.findMany({
            ids: pageIds,
            search: '',
            skip: 0,
            take: pageIds.length,
          });
    const byId = new Map(records.map((record) => [record.id, record]));
    const items: UserView[] = [];
    for (const id of pageIds) {
      const record = byId.get(id);
      if (record && !this.isMutuallyBlocked(viewerId, record, viewer)) {
        items.push(this.projectVisibleUser(record, false));
      }
    }
    return { items, page: createPageMeta(query, ids.length) };
  }

  private async visibleTarget(
    viewerId: string,
    targetId: string,
  ): Promise<{
    readonly target: UserRecord;
    readonly viewer: UserRecord | null;
  }> {
    const [target, viewer] = await Promise.all([
      this.users.findUnique(targetId),
      viewerId === targetId
        ? Promise.resolve(null)
        : this.users.findUnique(viewerId),
    ]);
    if (!target || this.isMutuallyBlocked(viewerId, target, viewer)) {
      throw new DomainError('NOT_FOUND', 'User not found.');
    }
    return { target, viewer };
  }

  private assertPrivateAccess(viewerId: string, target: UserRecord): void {
    if (
      isPrivate(target.privacy) &&
      viewerId !== target.id &&
      !parseIdList(target.followers, 'followers').includes(viewerId)
    ) {
      throw new DomainError('AUTHORIZATION_DENIED', 'This account is private.');
    }
  }

  private isMutuallyBlocked(
    viewerId: string,
    target: UserRecord,
    viewer: UserRecord | null,
  ): boolean {
    if (viewerId === target.id) return false;
    if (parseBlockedIds(target.blockedUsers).includes(viewerId)) return true;
    return viewer
      ? parseBlockedIds(viewer.blockedUsers).includes(target.id)
      : false;
  }

  private projectVisibleUser(
    user: UserRecord,
    canViewPrivateGraph: boolean,
  ): UserView {
    const privateProfile = isPrivate(user.privacy);
    const showGraph = !privateProfile || canViewPrivateGraph;
    return {
      ...projectUser(user),
      isPrivate: privateProfile,
      followersCount: showGraph
        ? parseIdList(user.followers, 'followers').length
        : null,
      followingCount: showGraph
        ? parseIdList(user.following, 'following').length
        : null,
    };
  }
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const allowedMimeTypes: readonly ImageMimeType[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
];

interface ValidatedImageFile {
  readonly bytes: Uint8Array;
  readonly mimeType: ImageMimeType;
}

const parseImageFile = (value: unknown): ValidatedImageFile => {
  if (typeof value !== 'object' || value === null) invalidImage();
  const buffer: unknown = Reflect.get(value, 'buffer');
  const mimeType: unknown = Reflect.get(value, 'mimetype');
  const declaredSize: unknown = Reflect.get(value, 'size');
  if (
    !(buffer instanceof Uint8Array) ||
    typeof mimeType !== 'string' ||
    typeof declaredSize !== 'number' ||
    !Number.isSafeInteger(declaredSize) ||
    declaredSize !== buffer.byteLength ||
    buffer.byteLength === 0 ||
    buffer.byteLength > MAX_IMAGE_BYTES ||
    !isImageMimeType(mimeType) ||
    !matchesSignature(buffer, mimeType)
  ) {
    invalidImage();
  }
  return { bytes: buffer, mimeType };
};

const isImageMimeType = (value: string): value is ImageMimeType =>
  allowedMimeTypes.some((mimeType) => mimeType === value);

const matchesSignature = (
  bytes: Uint8Array,
  mimeType: ImageMimeType,
): boolean => {
  if (mimeType === 'image/jpeg') {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === 'image/png') {
    return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (byte, index) => bytes[index] === byte,
    );
  }
  return (
    ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP') && bytes.byteLength >= 12
  );
};

const ascii = (bytes: Uint8Array, start: number, expected: string): boolean =>
  [...expected].every(
    (character, index) => bytes[start + index] === character.charCodeAt(0),
  );

const isHttpsUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname.length > 0 &&
      url.username.length === 0 &&
      url.password.length === 0
    );
  } catch {
    return false;
  }
};

const isPrismaNotFound = (value: unknown): boolean => {
  if (typeof value !== 'object' || value === null) return false;
  return Reflect.get(value, 'code') === 'P2025';
};

function invalidImage(): never {
  throw new DomainError(
    'VALIDATION_FAILED',
    'Upload a JPEG, PNG, or WebP image no larger than 5 MiB.',
  );
}

const isPrivate = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value !== 'object') invalidPersisted('privacy');
  const candidate: unknown = Reflect.get(value, 'isPrivate');
  if (candidate === undefined) return false;
  if (typeof candidate !== 'boolean') invalidPersisted('privacy.isPrivate');
  return candidate;
};

const parseIdList = (value: unknown, field: string): readonly string[] => {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) invalidPersisted(field);
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') invalidPersisted(field);
    ids.push(entry);
  }
  return ids;
};

const parseBlockedIds = (value: unknown): readonly string[] => {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) invalidPersisted('blockedUsers');
  return value.map((entry) => {
    if (typeof entry === 'string') return entry;
    if (typeof entry !== 'object' || entry === null) {
      invalidPersisted('blockedUsers');
    }
    const userId: unknown = Reflect.get(entry, 'userId');
    if (typeof userId === 'string') return userId;
    const user: unknown = Reflect.get(entry, 'user');
    if (typeof user === 'string') return user;
    if (typeof user === 'object' && user !== null) {
      const nestedId: unknown = Reflect.get(user, 'id');
      if (typeof nestedId === 'string') return nestedId;
    }
    invalidPersisted('blockedUsers');
  });
};

function invalidPersisted(field: string): never {
  void field;
  throw new DomainError(
    'INTERNAL_ERROR',
    'Stored user data could not be processed.',
  );
}
