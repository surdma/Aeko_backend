import { DynamicModule, Module } from '@nestjs/common';
import type { AppConfig } from './configuration/configuration/configuration.service';
import { ConfigurationModule } from './configuration/configuration.module';
import { DatabaseModule } from './database/database.module';
import type { PrismaLifecycleClient } from './database/prisma/prisma.service';
import { HealthModule } from './health/health.module';
import {
  RequestContext,
  RequestContextMiddleware,
} from './common/http/request-context/request-context.middleware';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ProfilesModule } from './profiles/profiles.module';
import { SecurityModule } from './security/security.module';
import { MediaModule } from './providers/media/media.module';
import { AdsModule } from './ads/ads.module';
import { MediaProcessingModule } from './providers/media-processing/media-processing.module';
import { PostsModule } from './posts/posts.module';
import { CommentsModule } from './comments/comments.module';
import { StatusModule } from './status/status.module';
import { ExploreModule } from './explore/explore.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ReportsModule } from './reports/reports.module';
import { DebatesModule } from './debates/debates.module';
import { ChallengesModule } from './challenges/challenges.module';
import { SpacesModule } from './spaces/spaces.module';
import { CoinsModule } from './coins/coins.module';
import { PaymentsModule } from './payments/payments.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { SubscriptionPlansModule } from './subscription-plans/subscription-plans.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { CommunitiesModule } from './communities/communities.module';
import { CommunityProfilesModule } from './community-profiles/community-profiles.module';
import { CommunityPaymentsModule } from './community-payments/community-payments.module';
import { RealtimeModule } from './realtime/realtime.module';
import { RealtimeModule } from './realtime/realtime.module';
import { ChatModule } from './chat/chat.module';
import { ChatMediaModule } from './chat-media/chat-media.module';
import { ChatDeliveryModule } from './chat-delivery/chat-delivery.module';
import { VideoCallsModule } from './video-calls/video-calls.module';
import { BotModule } from './bot/bot.module';

@Module({
  imports: [
    RealtimeModule,
    UsersModule,
    ProfilesModule,
    SecurityModule,
    MediaModule,
    AdsModule,
    MediaProcessingModule,
    PostsModule,
    CommentsModule,
    StatusModule,
    ExploreModule,
    NotificationsModule,
    ReportsModule,
    DebatesModule,
    ChallengesModule,
    SpacesModule,
    CoinsModule,
    PaymentsModule,
    SubscriptionsModule,
    SubscriptionPlansModule,
    WebhooksModule,
    CommunitiesModule,
    CommunityProfilesModule,
    CommunityPaymentsModule,
    RealtimeModule,
    ChatModule,
    ChatMediaModule,
    ChatDeliveryModule,
    VideoCallsModule,
    BotModule,
  ],
})
export class AppModule {
  static register(
    configuration: AppConfig,
    databaseClient?: PrismaLifecycleClient,
  ): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigurationModule.register(configuration),
        DatabaseModule.register(configuration, databaseClient),
        AuthModule,
        HealthModule,
      ],
      providers: [RequestContext, RequestContextMiddleware],
      exports: [RequestContext],
    };
  }
}
