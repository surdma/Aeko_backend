import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { pathToFileURL } from 'node:url';
import { AppModule } from './app.module.js';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { SanitizedLogger } from './common/sanitized-logger.js';
import { APP_CONFIGURATION, type AppConfiguration } from './config/configuration.js';

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    logger: false,
  });
  const configuration = app.get<AppConfiguration>(APP_CONFIGURATION);
  const logger = app.get<SanitizedLogger>(SanitizedLogger);

  app.useLogger(logger);
  app.useGlobalFilters(app.get<HttpExceptionFilter>(HttpExceptionFilter));
  app.enableCors({
    credentials: true,
    origin: [...configuration.http.corsOrigins],
  });
  app.useBodyParser('json', {
    limit: configuration.http.bodyLimit,
  });
  app.useBodyParser('urlencoded', {
    extended: true,
    limit: configuration.http.bodyLimit,
  });
  app.set('trust proxy', configuration.http.trustProxy);
  app.enableShutdownHooks();

  return app;
}

async function bootstrap(): Promise<void> {
  const app = await createApp();
  const configuration = app.get<AppConfiguration>(APP_CONFIGURATION);

  await app.listen(configuration.app.port, configuration.app.host);
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  void bootstrap().catch((error: unknown) => {
    const logger = new SanitizedLogger();
    logger.fatal('NestJS bootstrap failed', error);
    process.exitCode = 1;
  });
}
