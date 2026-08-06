import {
  ArgumentsHost,
  Catch,
  HttpStatus,
  Injectable,
  type ExceptionFilter,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { ThrottlerException } from '@nestjs/throttler';

@Catch(ThrottlerException)
@Injectable()
export class WaitlistThrottlerExceptionFilter
  implements ExceptionFilter<ThrottlerException>
{
  public constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  public catch(_exception: ThrottlerException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<unknown>();

    this.httpAdapterHost.httpAdapter.reply(
      response,
      {
        success: false,
        message: 'Too many requests, please try again later',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
