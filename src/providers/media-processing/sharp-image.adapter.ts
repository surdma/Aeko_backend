import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { DomainError } from '../../common/errors/domain.error';
import {
  ImageProcessorPort,
  type ProcessImageInput,
  type ProcessedMedia,
} from './image-processor.port';
import { STORAGE_ROOT, publicUrl } from './storage';

interface SharpPipeline {
  greyscale(): SharpPipeline;
  blur(sigma: number): SharpPipeline;
  rotate(angle: number): SharpPipeline;
  toBuffer(): Promise<Uint8Array>;
}

type SharpFactory = (input: Uint8Array) => SharpPipeline;

const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

@Injectable()
export class SharpImageAdapter extends ImageProcessorPort {
  async process(input: ProcessImageInput): Promise<ProcessedMedia> {
    const sharp = await loadSharp();
    const edited = await this.transform(sharp, input);

    const name = `edited_${randomUUID()}.${EXTENSIONS[input.mimeType] ?? 'bin'}`;
    const target = join(STORAGE_ROOT, name);
    await mkdir(STORAGE_ROOT, { recursive: true });
    try {
      await writeFile(target, edited);
    } catch {
      // Never leave a partial file behind for a later request to serve.
      await rm(target, { force: true }).catch(() => undefined);
      throw new DomainError(
        'PROVIDER_UNAVAILABLE',
        'Image processing is unavailable.',
      );
    }
    return { url: publicUrl(name) };
  }

  private async transform(
    sharp: SharpFactory,
    input: ProcessImageInput,
  ): Promise<Uint8Array> {
    let pipeline = sharp(input.bytes);
    // Effects are a closed allowlist; the legacy magnitudes are preserved.
    if (input.effect === 'greyscale') pipeline = pipeline.greyscale();
    if (input.effect === 'blur') pipeline = pipeline.blur(5);
    if (input.effect === 'rotate') pipeline = pipeline.rotate(90);
    return pipeline.toBuffer();
  }
}

/**
 * Sharp ships native binaries and may be absent on a host. Legacy answered a
 * fixed 503 in that case and so does this.
 */
const loadSharp = async (): Promise<SharpFactory> => {
  const loaded: unknown = await import('sharp').catch(() => null);
  const factory: unknown =
    typeof loaded === 'object' && loaded !== null
      ? Reflect.get(loaded, 'default')
      : null;
  if (typeof factory !== 'function') throw unavailable();
  return (bytes: Uint8Array): SharpPipeline =>
    wrapPipeline(Reflect.apply(factory, undefined, [bytes]));
};

/**
 * Sharp is loaded dynamically, so its shape is verified rather than asserted:
 * each method used below must actually exist before it is called.
 */
const wrapPipeline = (value: unknown): SharpPipeline => {
  if (typeof value !== 'object' || value === null) throw unavailable();
  const call = (method: string, args: readonly unknown[]): unknown => {
    const candidate: unknown = Reflect.get(value, method);
    if (typeof candidate !== 'function') throw unavailable();
    return Reflect.apply(candidate, value, args);
  };
  return {
    greyscale: () => wrapPipeline(call('greyscale', [])),
    blur: (sigma: number) => wrapPipeline(call('blur', [sigma])),
    rotate: (angle: number) => wrapPipeline(call('rotate', [angle])),
    toBuffer: async () => {
      const buffer: unknown = await call('toBuffer', []);
      if (!(buffer instanceof Uint8Array)) throw unavailable();
      return buffer;
    },
  };
};

const unavailable = (): DomainError =>
  new DomainError('PROVIDER_UNAVAILABLE', 'Image processing is unavailable.');
