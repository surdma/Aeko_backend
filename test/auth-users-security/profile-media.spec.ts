import {
  GUARDS_METADATA,
  INTERCEPTORS_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedPrincipal } from '../../src/auth/auth.types';
import { SessionGuard } from '../../src/auth/guards/session/session.guard';
import { TwoFactorGuard } from '../../src/auth/guards/two-factor/two-factor.guard';
import { DomainError } from '../../src/common/errors/domain.error';
import { loadAppConfig } from '../../src/configuration/configuration/configuration.service';
import { PrismaService } from '../../src/database/prisma/prisma.service';
import {
  MediaPort,
  type UploadImageInput,
  type UploadedMedia,
} from '../../src/providers/media/media.port';
import { CloudinaryMediaAdapter } from '../../src/providers/media/cloudinary-media.adapter';
import { ConfigurationService } from '../../src/configuration/configuration/configuration.service';
import { UsersController } from '../../src/users/users.controller';
import { UsersModule } from '../../src/users/users.module';
import { UsersService } from '../../src/users/users.service';
import { MediaModule } from '../../src/providers/media/media.module';

const principal: AuthenticatedPrincipal = {
  userId: 'u1',
  email: 'user@example.com',
  username: 'user',
  isAdmin: false,
  banned: false,
  twoFactorEnabled: true,
  twoFactorSatisfied: true,
  sessionId: 'session-1',
};

const pngBytes = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01,
]);

interface TestFile {
  readonly buffer: Uint8Array;
  readonly mimetype: string;
  readonly size: number;
}

const file = (bytes: Uint8Array, mimetype = 'image/png'): TestFile => ({
  buffer: bytes,
  mimetype,
  size: bytes.byteLength,
});

class RecordingMedia extends MediaPort {
  readonly uploadCalls: UploadImageInput[] = [];
  readonly deleteCalls: string[] = [];
  response: UploadedMedia | undefined;
  failure: Error | undefined;
  deleteFailure: Error | undefined;

  uploadProfileImage(input: UploadImageInput): Promise<UploadedMedia> {
    this.uploadCalls.push(input);
    if (this.failure) return Promise.reject(this.failure);
    return Promise.resolve(
      this.response ?? {
        url: `https://media.example/users/${input.ownerId}/${input.purpose}.png`,
        providerId: `aeko/users/${input.ownerId}/${input.purpose}`,
      },
    );
  }

  deleteProfileImage(providerId: string): Promise<void> {
    this.deleteCalls.push(providerId);
    return this.deleteFailure
      ? Promise.reject(this.deleteFailure)
      : Promise.resolve();
  }
}

const updateCalls: unknown[] = [];
let databaseFailure: Error | undefined;

const fakeClient = {
  $connect: (): Promise<void> => Promise.resolve(),
  $disconnect: (): Promise<void> => Promise.resolve(),
  $queryRaw: (): Promise<unknown> => Promise.resolve(1),
  $transaction: (): Promise<unknown> => Promise.resolve(undefined),
  user: {
    findUnique: (): Promise<null> => Promise.resolve(null),
    findMany: (): Promise<readonly unknown[]> => Promise.resolve([]),
    count: (): Promise<number> => Promise.resolve(0),
    delete: (): Promise<unknown> => Promise.resolve({}),
    update: (input: unknown): Promise<unknown> => {
      updateCalls.push(input);
      if (databaseFailure) return Promise.reject(databaseFailure);
      const serialized = JSON.stringify(input);
      return Promise.resolve(
        serialized.includes('profilePicture')
          ? { profilePicture: 'https://media.example/users/u1/cover.png' }
          : { coverPicture: 'https://media.example/users/u1/cover.png' },
      );
    },
  },
};

const createService = (media: MediaPort): UsersService =>
  new UsersService(new PrismaService(fakeClient), media);

const expectCode = async (
  promise: Promise<unknown>,
  code: string,
): Promise<void> => {
  await expect(promise).rejects.toBeInstanceOf(DomainError);
  await expect(promise).rejects.toMatchObject({ code });
};

describe('protected profile media', () => {
  beforeEach(() => {
    updateCalls.length = 0;
    databaseFailure = undefined;
  });

  it('imports the media provider boundary into the users feature module', () => {
    const imports = new Reflector().get<readonly unknown[]>(
      MODULE_METADATA.IMPORTS,
      UsersModule,
    );
    expect(imports).toEqual(expect.arrayContaining([MediaModule]));
  });

  it('registers exactly two PUT upload routes with session, 2FA, and file interceptors', () => {
    const prototype: object = UsersController.prototype;
    const reflector = new Reflector();
    const uploadRoutes = Object.getOwnPropertyNames(prototype)
      .filter((name) => name.toLocaleLowerCase().includes('picture'))
      .map((name) => {
        const handler: unknown = Reflect.get(prototype, name);
        if (typeof handler !== 'function') throw new Error('handler missing');
        return {
          path: reflector.get<unknown>(PATH_METADATA, handler),
          method: reflector.get<unknown>(METHOD_METADATA, handler),
          guards: reflector.get<readonly unknown[]>(GUARDS_METADATA, handler),
          interceptors: reflector.get<readonly unknown[]>(
            INTERCEPTORS_METADATA,
            handler,
          ),
        };
      });

    expect(uploadRoutes).toHaveLength(2);
    expect(uploadRoutes.map(({ path, method }) => ({ path, method }))).toEqual([
      { path: 'profile-picture', method: RequestMethod.PUT },
      { path: 'cover-picture', method: RequestMethod.PUT },
    ]);
    for (const route of uploadRoutes) {
      expect(route.guards).toEqual([SessionGuard, TwoFactorGuard]);
      expect(route.interceptors ?? []).toHaveLength(1);
    }
  });

  it.each([
    ['missing', undefined],
    ['empty', file(new Uint8Array(), 'image/png')],
    ['oversize', file(new Uint8Array(5 * 1024 * 1024 + 1), 'image/png')],
    ['unsupported MIME', file(pngBytes, 'application/octet-stream')],
    ['spoofed MIME', file(Buffer.from('MZ executable'), 'image/png')],
  ])(
    'rejects %s uploads before provider and database calls',
    async (_label, upload) => {
      const media = new RecordingMedia();

      await expectCode(
        createService(media).updateProfilePicture(principal, upload),
        'VALIDATION_FAILED',
      );

      expect(media.uploadCalls).toEqual([]);
      expect(updateCalls).toEqual([]);
    },
  );

  it('uploads valid media before updating only the selected user field', async () => {
    const media = new RecordingMedia();

    await expect(
      createService(media).updateCoverPicture(principal, file(pngBytes)),
    ).resolves.toEqual({
      coverPicture: 'https://media.example/users/u1/cover.png',
    });

    expect(media.uploadCalls).toEqual([
      {
        ownerId: 'u1',
        purpose: 'cover',
        bytes: pngBytes,
        mimeType: 'image/png',
      },
    ]);
    expect(updateCalls).toEqual([
      {
        where: { id: 'u1' },
        data: { coverPicture: 'https://media.example/users/u1/cover.png' },
        select: { coverPicture: true },
      },
    ]);
    expect(media.deleteCalls).toEqual([]);
  });

  it('sanitizes provider failures and never updates the database', async () => {
    const media = new RecordingMedia();
    media.failure = new Error('cloud secret and provider response');

    const operation = createService(media).updateProfilePicture(
      principal,
      file(pngBytes),
    );
    await expectCode(operation, 'PROVIDER_UNAVAILABLE');
    await expect(operation).rejects.toMatchObject({
      message: 'The media provider is temporarily unavailable.',
    });
    expect(updateCalls).toEqual([]);
  });

  it.each([
    [{ url: 'http://media.example/image.png', providerId: 'provider-1' }],
    [{ url: 'not-a-url', providerId: 'provider-1' }],
    [{ url: 'https://media.example/image.png', providerId: '' }],
    [{ url: 'https://media.example/image.png', providerId: 'provider-1' }],
  ])(
    'rejects malformed provider results before database updates',
    async (response) => {
      const media = new RecordingMedia();
      media.response = response;

      await expectCode(
        createService(media).updateProfilePicture(principal, file(pngBytes)),
        'PROVIDER_UNAVAILABLE',
      );
      expect(updateCalls).toEqual([]);
    },
  );

  it('removes the uploaded asset and sanitizes an unknown database failure', async () => {
    const media = new RecordingMedia();
    databaseFailure = new Error('database unavailable');

    await expectCode(
      createService(media).updateProfilePicture(principal, file(pngBytes)),
      'INTERNAL_ERROR',
    );
    expect(media.deleteCalls).toEqual(['aeko/users/u1/profile']);
  });

  it('maps an absent user update to not found after bounded cleanup', async () => {
    const media = new RecordingMedia();
    databaseFailure = Object.assign(new Error('raw prisma details'), {
      code: 'P2025',
    });

    const operation = createService(media).updateProfilePicture(
      principal,
      file(pngBytes),
    );
    await expectCode(operation, 'NOT_FOUND');
    await expect(operation).rejects.toMatchObject({
      message: 'User not found.',
    });
    expect(media.deleteCalls).toEqual(['aeko/users/u1/profile']);
  });

  it('preserves the sanitized database error when cleanup also fails', async () => {
    const media = new RecordingMedia();
    media.deleteFailure = new Error('raw cleanup provider body');
    databaseFailure = Object.assign(new Error('raw prisma details'), {
      code: 'P2025',
    });

    const operation = createService(media).updateProfilePicture(
      principal,
      file(pngBytes),
    );
    await expectCode(operation, 'NOT_FOUND');
    await expect(operation).rejects.toMatchObject({
      message: 'User not found.',
    });
  });

  it('parses valid escaped Cloudinary JSON with runtime-checked fields', async () => {
    const configuration = new ConfigurationService(
      loadAppConfig({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://aeko:test@localhost:5432/aeko_test',
        BETTER_AUTH_SECRET: 'test-secret-with-at-least-thirty-two-characters',
        BETTER_AUTH_URL: 'http://localhost:3000',
        CLOUDINARY_CLOUD_NAME: 'aeko',
        CLOUDINARY_API_KEY: 'api-key',
        CLOUDINARY_API_SECRET: 'api-secret',
      }),
    );
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          '{  "secure_url" : "https:\\/\\/media.example\\/image.png", "public_id" : "aeko\\/users\\/u1\\/profile" }',
          { status: 200 },
        ),
      );

    await expect(
      new CloudinaryMediaAdapter(configuration).uploadProfileImage({
        ownerId: 'u1',
        purpose: 'profile',
        bytes: pngBytes,
        mimeType: 'image/png',
      }),
    ).resolves.toEqual({
      url: 'https://media.example/image.png',
      providerId: 'aeko/users/u1/profile',
    });
    fetchSpy.mockRestore();
  });

  it('accepts Cloudinary credentials only when all three values are configured', () => {
    const base: NodeJS.ProcessEnv = {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://aeko:test@localhost:5432/aeko_test',
      BETTER_AUTH_SECRET: 'test-secret-with-at-least-thirty-two-characters',
      BETTER_AUTH_URL: 'http://localhost:3000',
    };
    expect(() =>
      loadAppConfig({ ...base, CLOUDINARY_CLOUD_NAME: 'aeko' }),
    ).toThrow('CLOUDINARY_CLOUD_NAME');
    expect(
      loadAppConfig({
        ...base,
        CLOUDINARY_CLOUD_NAME: 'aeko',
        CLOUDINARY_API_KEY: 'api-key',
        CLOUDINARY_API_SECRET: 'api-secret',
      }).providerCredentials,
    ).toMatchObject({
      cloudinaryCloudName: 'aeko',
      cloudinaryApiKey: 'api-key',
      cloudinaryApiSecret: 'api-secret',
    });
  });
});
