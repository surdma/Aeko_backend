import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { pathToFileURL } from 'node:url';
import type { Express } from 'express';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module.js';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { SanitizedLogger } from './common/sanitized-logger.js';
import { APP_CONFIGURATION, type AppConfiguration } from './config/configuration.js';

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    logger: false,
  });
  const configuration = app.get<AppConfiguration>(APP_CONFIGURATION);
  const logger = app.get(SanitizedLogger);
  const expressApplication = app.getHttpAdapter().getInstance<Express>();

  app.useLogger(logger);
  app.useGlobalFilters(app.get(HttpExceptionFilter));
  app.enableCors({
    credentials: true,
    origin: [...configuration.http.corsOrigins],
  });
  app.use(json({ limit: configuration.http.bodyLimit }));
  app.use(urlencoded({
    extended: true,
    limit: configuration.http.bodyLimit,
  }));
  app.enableShutdownHooks();
  expressApplication.set('trust proxy', configuration.http.trustProxy);

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
