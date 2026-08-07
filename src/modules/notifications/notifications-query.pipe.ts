import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

export class NotificationsQueryPipe<TSchema extends z.ZodTypeAny>
  implements PipeTransform<unknown, z.infer<TSchema>>
{
  public constructor(
    private readonly schema: TSchema,
    private readonly message: string,
  ) {}

  public transform(value: unknown): z.infer<TSchema> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({ error: this.message });
    }
    return result.data;
  }
}
