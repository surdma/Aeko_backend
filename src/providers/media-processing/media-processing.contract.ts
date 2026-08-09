import { z } from 'zod';

import { DomainError } from '../../common/errors/domain.error';

export type ImageEffect = 'none' | 'greyscale' | 'blur' | 'rotate';
export type VideoEffect = 'none' | 'grayscale' | 'negate' | 'blur';

export interface ImageProcessingRequest {
  readonly effect: ImageEffect;
}

export interface VideoProcessingRequest {
  readonly effect: VideoEffect;
}

const imageEffectSchema = z
  .object({
    filter: z.enum(['none', 'greyscale', 'blur', 'rotate']).default('none'),
  })
  .strict();

const videoEffectSchema = z
  .object({
    effect: z.enum(['none', 'grayscale', 'negate', 'blur']).default('none'),
  })
  .strict();

const fail = (scope: string, error: z.ZodError): never => {
  const fields = error.issues.map((issue) =>
    issue.path.length > 0 ? issue.path.join('.') : 'effect',
  );
  throw new DomainError(
    'VALIDATION_FAILED',
    `Invalid ${scope}: ${fields.join(', ')}`,
    {
      [scope]: error.issues.map((issue) => issue.message),
    },
  );
};

export const parseImageEffect = (input: unknown): ImageProcessingRequest => {
  const result = imageEffectSchema.safeParse(input);
  return result.success
    ? Object.freeze({ effect: result.data.filter })
    : fail('image effect', result.error);
};

export const parseVideoEffect = (input: unknown): VideoProcessingRequest => {
  const result = videoEffectSchema.safeParse(input);
  return result.success
    ? Object.freeze({ effect: result.data.effect })
    : fail('video effect', result.error);
};
