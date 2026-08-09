import { DynamicModule, Module } from '@nestjs/common';
import {
  APP_CONFIG,
  type AppConfig,
  ConfigurationService,
} from './configuration/configuration.service';

@Module({})
export class ConfigurationModule {
  static register(configuration: AppConfig): DynamicModule {
    return {
      module: ConfigurationModule,
      global: true,
      providers: [
        { provide: APP_CONFIG, useValue: configuration },
        ConfigurationService,
      ],
      exports: [APP_CONFIG, ConfigurationService],
    };
  }
}
