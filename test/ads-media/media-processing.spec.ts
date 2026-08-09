import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';

import { SessionGuard } from '../../src/auth/guards/session/session.guard';
import { MediaProcessingController } from '../../src/providers/media-processing/media-processing.controller';
import { MediaProcessingService } from '../../src/providers/media-processing/media-processing.service';
import {
  ImageProcessorPort,
  type ProcessedMedia,
  type ProcessImageInput,
} from '../../src/providers/media-processing/image-processor.port';
import {
  VideoProcessorPort,
  type ProcessVideoInput,
} from '../../src/providers/media-processing/video-processor.port';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const pngBytes = (size = 64): Uint8Array => {
  const bytes = new Uint8Array(size);
  bytes.set(PNG_MAGIC, 0);
  return bytes;
};

const mp4Bytes = (size = 64): Uint8Array => {
  const bytes = new Uint8Array(size);
  // ....ftypisom
  bytes.set([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70], 0);
  return bytes;
};

const file = (
  fieldname: string,
  mimetype: string,
  buffer: Uint8Array,
  originalname = 'input.png',
): Record<string, unknown> => ({
  fieldname,
  originalname,
  mimetype,
  size: buffer.byteLength,
  buffer,
});

class StubImageProcessor extends ImageProcessorPort {
  calls: ProcessImageInput[] = [];
  result: ProcessedMedia = { url: 'https://cdn.example.com/edited.png' };
  failure: Error | null = null;

  process(input: ProcessImageInput): Promise<ProcessedMedia> {
    this.calls.push(input);
    return this.failure
      ? Promise.reject(this.failure)
      : Promise.resolve(this.result);
  }
}

class StubVideoProcessor extends VideoProcessorPort {
  calls: ProcessVideoInput[] = [];
  result: ProcessedMedia = { url: '/uploads/edited.mp4' };
  failure: Error | null = null;

  process(input: ProcessVideoInput): Promise<ProcessedMedia> {
    this.calls.push(input);
    return this.failure
      ? Promise.reject(this.failure)
      : Promise.resolve(this.result);
  }
}

const createService = (): {
  readonly service: MediaProcessingService;
  readonly images: StubImageProcessor;
  readonly videos: StubVideoProcessor;
} => {
  const images = new StubImageProcessor();
  const videos = new StubVideoProcessor();
  return {
    service: new MediaProcessingService(images, videos),
    images,
    videos,
  };
};

describe('media processing service', () => {
  it('edits a valid photo through the image port', async () => {
    const { service, images } = createService();
    const result = await service.editPhoto(
      file('photo', 'image/png', pngBytes()),
      { filter: 'greyscale' },
    );

    expect(result).toEqual({ url: 'https://cdn.example.com/edited.png' });
    expect(images.calls).toHaveLength(1);
    expect(images.calls[0]?.effect).toBe('greyscale');
    expect(images.calls[0]?.mimeType).toBe('image/png');
  });

  it('edits a valid video through the video port', async () => {
    const { service, videos } = createService();
    const result = await service.editVideo(
      file('video', 'video/mp4', mp4Bytes(), 'input.mp4'),
      { effect: 'negate' },
    );

    expect(result).toEqual({ url: '/uploads/edited.mp4' });
    expect(videos.calls[0]?.effect).toBe('negate');
  });

  it('requires an uploaded file', async () => {
    const { service } = createService();
    await expect(
      service.editPhoto(undefined, { filter: 'blur' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      service.editVideo(null, { effect: 'blur' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects declared types outside the allowlist', async () => {
    const { service, images } = createService();
    await expect(
      service.editPhoto(
        file('photo', 'application/x-msdownload', pngBytes(), 'payload.exe'),
        { filter: 'blur' },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(images.calls).toHaveLength(0);
  });

  it('rejects content whose magic bytes contradict the declared type', async () => {
    const { service, images } = createService();
    const executable = new Uint8Array(64);
    executable.set([0x4d, 0x5a], 0); // MZ

    await expect(
      service.editPhoto(file('photo', 'image/png', executable), {
        filter: 'blur',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(images.calls).toHaveLength(0);
  });

  it('rejects oversized uploads before calling a provider', async () => {
    const { service, images, videos } = createService();

    await expect(
      service.editPhoto(
        file('photo', 'image/png', pngBytes(11 * 1024 * 1024)),
        {
          filter: 'blur',
        },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      service.editVideo(
        file('video', 'video/mp4', mp4Bytes(101 * 1024 * 1024), 'big.mp4'),
        { effect: 'blur' },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(images.calls).toHaveLength(0);
    expect(videos.calls).toHaveLength(0);
  });

  it('rejects effects outside the legacy allowlist', async () => {
    const { service, images } = createService();
    await expect(
      service.editPhoto(file('photo', 'image/png', pngBytes()), {
        filter: 'shell-command',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(images.calls).toHaveLength(0);
  });

  it('never leaks a provider error message or a filesystem path', async () => {
    const { service, images } = createService();
    images.failure = new Error(
      'sharp: /var/data/uploads/secret-input.png is not a valid image',
    );

    const failure: unknown = await service
      .editPhoto(file('photo', 'image/png', pngBytes()), { filter: 'blur' })
      .then(
        () => null,
        (error: unknown) => error,
      );

    expect(failure).toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    const message =
      failure instanceof Error ? failure.message : String(failure);
    expect(message).not.toContain('/var/data');
    expect(message).not.toContain('sharp');
  });
});

describe('media processing routes', () => {
  const reflector = new Reflector();
  const handlerOf = (method: string) => {
    const handler: unknown = Reflect.get(
      MediaProcessingController.prototype,
      method,
    );
    if (typeof handler !== 'function') {
      throw new Error(`MediaProcessingController.${method} is missing`);
    }
    return handler;
  };

  it('exposes the exact legacy editing routes', () => {
    expect(reflector.get<unknown>(PATH_METADATA, handlerOf('editPhoto'))).toBe(
      'api/photo/edit',
    );
    expect(
      reflector.get<unknown>(METHOD_METADATA, handlerOf('editPhoto')),
    ).toBe(RequestMethod.POST);
    expect(reflector.get<unknown>(PATH_METADATA, handlerOf('editVideo'))).toBe(
      'api/video/edit',
    );
    expect(
      reflector.get<unknown>(METHOD_METADATA, handlerOf('editVideo')),
    ).toBe(RequestMethod.POST);
  });

  it('requires an authenticated session, which the legacy routes did not', () => {
    expect(
      reflector.get<readonly unknown[]>(
        GUARDS_METADATA,
        MediaProcessingController,
      ),
    ).toEqual([SessionGuard]);
  });
});
