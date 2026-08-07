import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { SanitizedLogger } from './common/sanitized-logger.js';
import {
  APP_CONFIGURATION,
  type AppConfiguration,
} from './config/configuration.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    abortOnError: false,
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
  app.useBodyParser('json', { limit: configuration.http.bodyLimit });
  app.useBodyParser('urlencoded', {
    extended: true,
    limit: configuration.http.bodyLimit,
  });
  app.set('trust proxy', configuration.http.trustProxy);
  app.enableShutdownHooks();
  await app.listen(configuration.app.port, configuration.app.host);
}

void bootstrap().catch((error: unknown) => {
  const logger = new SanitizedLogger();
  logger.fatal('NestJS bootstrap failed', error);
  process.exitCode = 1;
});
