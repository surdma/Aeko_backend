import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

export class ZodBodyPipe<TSchema extends z.ZodTypeAny>
  implements PipeTransform<unknown, z.infer<TSchema>>
{
  public constructor(
    private readonly schema: TSchema,
    private readonly publicMessage: string,
  ) {}

  public transform(value: unknown): z.infer<TSchema> {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      throw new BadRequestException({
        success: false,
        message: this.publicMessage,
      });
    }
    return parsed.data;
  }
}
