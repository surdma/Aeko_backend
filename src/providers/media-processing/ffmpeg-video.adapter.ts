import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { DomainError } from '../../common/errors/domain.error';
import type { ProcessedMedia } from './image-processor.port';
import type { VideoEffect } from './media-processing.contract';
import { STORAGE_ROOT, publicUrl } from './storage';
import {
  VideoProcessorPort,
  type ProcessVideoInput,
} from './video-processor.port';

const PROCESS_TIMEOUT_MILLISECONDS = 60_000;

/**
 * The executable name is fixed here rather than read from a request. Combined
 * with `shell: false` and a fixed argument array, there is no path by which
 * caller input reaches a shell.
 */
const FFMPEG_EXECUTABLE = process.env.FFMPEG_PATH ?? 'ffmpeg';

/** Closed allowlist; the legacy filter strings are preserved exactly. */
const VIDEO_FILTERS: Readonly<Record<VideoEffect, string | null>> = {
  none: null,
  grayscale: 'hue=s=0',
  negate: 'negate',
  blur: 'boxblur=10:1',
};

@Injectable()
export class FfmpegVideoAdapter extends VideoProcessorPort {
  async process(input: ProcessVideoInput): Promise<ProcessedMedia> {
    await mkdir(STORAGE_ROOT, { recursive: true });
    const token = randomUUID();
    const source = join(STORAGE_ROOT, `source_${token}`);
    const name = `edited_${token}.mp4`;
    const target = join(STORAGE_ROOT, name);

    try {
      await writeFile(source, input.bytes);
      const filter = VIDEO_FILTERS[input.effect];
      const args = [
        '-nostdin',
        '-y',
        '-i',
        source,
        ...(filter === null ? [] : ['-vf', filter]),
        target,
      ];
      await run(args);
      return { url: publicUrl(name) };
    } catch (error: unknown) {
      await rm(target, { force: true }).catch(() => undefined);
      throw error instanceof DomainError
        ? error
        : new DomainError(
            'PROVIDER_UNAVAILABLE',
            'Video processing is unavailable.',
          );
    } finally {
      // The source copy is temporary regardless of the outcome.
      await rm(source, { force: true }).catch(() => undefined);
    }
  }
}

const run = (args: readonly string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(FFMPEG_EXECUTABLE, [...args], {
      shell: false,
      stdio: 'ignore',
      timeout: PROCESS_TIMEOUT_MILLISECONDS,
    });
    child.on('error', () => {
      reject(
        new DomainError(
          'PROVIDER_UNAVAILABLE',
          'Video processing is unavailable.',
        ),
      );
    });
    child.on('close', (code: number | null) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new DomainError(
          'PROVIDER_UNAVAILABLE',
          'Video processing is unavailable.',
        ),
      );
    });
  });
