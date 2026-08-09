import { INestApplication, Logger, type LoggerService } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/errors/global-exception/global-exception.filter';
import {
  RequestContext,
  RequestContextMiddleware,
} from './common/http/request-context/request-context.middleware';
import { ResponseCompatibilityInterceptor } from './common/http/response-compatibility/response-compatibility.interceptor';
import { loadAppConfig } from './configuration/configuration/configuration.service';
import type { PrismaLifecycleClient } from './database/prisma/prisma.service';

export interface ApplicationOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly databaseClient?: PrismaLifecycleClient;
  readonly logger?: LoggerService | false;
}

export async function createApplication(
  options: ApplicationOptions = {},
): Promise<INestApplication> {
  const configuration = loadAppConfig(options.environment ?? process.env);
  const application = await NestFactory.create<NestExpressApplication>(
    AppModule.register(configuration, options.databaseClient),
    {
      bodyParser: false,
      rawBody: true,
      logger: options.logger ?? ['error', 'warn', 'log'],
    },
  );
  const requestContext = application.get(RequestContextMiddleware);
  application.use(
    (request: Request, response: Response, next: NextFunction) => {
      requestContext.use(request, response, next);
    },
  );
  application.use(helmet());
  application.use(cookieParser());
  application.enableCors({
    origin:
      configuration.trustedOrigins.length > 0
        ? [...configuration.trustedOrigins]
        : false,
    credentials: true,
  });
  application.set(
    'trust proxy',
    configuration.proxyHops === 0 ? false : configuration.proxyHops,
  );
  application.useBodyParser('json', { limit: '50mb' });
  application.useBodyParser('urlencoded', { extended: true, limit: '50mb' });
  application.useGlobalInterceptors(new ResponseCompatibilityInterceptor());
  application.useGlobalFilters(
    new GlobalExceptionFilter(
      new Logger(GlobalExceptionFilter.name),
      application.get(RequestContext),
    ),
  );
  application.enableShutdownHooks();
  await application.init();
  return application;
}

async function bootstrap(): Promise<void> {
  const configuration = loadAppConfig(process.env);
  const application = await createApplication({ environment: process.env });
  await application.listen(configuration.port);
}

if (require.main === module) {
  bootstrap().catch(() => {
    process.exitCode = 1;
  });
}
