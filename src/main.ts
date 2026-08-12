import { INestApplication, Logger, type LoggerService } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AuthRuntimeService } from './auth/auth-runtime.service';
import { GlobalExceptionFilter } from './common/errors/global-exception/global-exception.filter';
import {
  RequestContext,
  RequestContextMiddleware,
} from './common/http/request-context/request-context.middleware';
import { ResponseCompatibilityInterceptor } from './common/http/response-compatibility/response-compatibility.interceptor';
import { loadAppConfig } from './configuration/configuration/configuration.service';
import {
  type PrismaLifecycleClient,
  PrismaService,
} from './database/prisma/prisma.service';
import { createAekoAuth } from './lib/auth/auth.config';
import type { AuthEmailPort } from './lib/auth/auth-email.port';
import { RedisConnectionsService } from './realtime/redis-connections.service';
import { SocketIoRedisAdapter } from './realtime/socket-io-redis.adapter';

export interface ApplicationOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly databaseClient?: PrismaLifecycleClient;
  readonly authEmailPort?: AuthEmailPort;
  readonly authInitializer?: AekoAuthInitializer;
  readonly logger?: LoggerService | false;
}

export type AekoAuthInitializer = (context: {
  readonly application: NestExpressApplication;
  readonly configuration: ReturnType<typeof loadAppConfig>;
  readonly emailPort?: AuthEmailPort;
}) => Promise<void>;

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
  const initializeAuth = options.authInitializer ?? initializeAekoAuth;
  await initializeAuth({
    application,
    configuration,
    ...(options.authEmailPort ? { emailPort: options.authEmailPort } : {}),
  });
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
  // Socket.IO creates its server during initialization, so this must happen
  // before init/listen. A Redis outage deliberately leaves the local adapter
  // active while health reports degraded rather than blocking HTTP chat.
  await application.get(RedisConnectionsService).connect();
  application.useWebSocketAdapter(application.get(SocketIoRedisAdapter));
  await application.init();
  return application;
}

async function initializeAekoAuth({
  application,
  configuration,
  emailPort,
}: Parameters<AekoAuthInitializer>[0]): Promise<void> {
  const auth = await createAekoAuth(
    application.get(PrismaService).adapterClient,
    configuration,
    emailPort,
  );
  application.get(AuthRuntimeService).initialize(auth);
  const { toNodeHandler } = await import('better-auth/node');
  const authHandler = toNodeHandler(auth);
  application.use(
    (request: Request, response: Response, next: NextFunction) => {
      const pathname = new URL(request.originalUrl, configuration.betterAuthUrl)
        .pathname;
      if (pathname === '/api/auth' || pathname.startsWith('/api/auth/')) {
        void Promise.resolve(authHandler(request, response)).catch(next);
        return;
      }
      next();
    },
  );
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
