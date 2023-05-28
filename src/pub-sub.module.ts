import { DiscoveryModule, DiscoveryService } from '@golevelup/nestjs-discovery';
import { Global, Module, ConfigurableModuleBuilder, DynamicModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import GooglePubSubClientService from './clients/google/google-pub-sub-client.service';
import PubSubService from './pub-sub.service';
import { PubSubModuleOptions } from './pub-sub.model';
import googlePubSubClientConfig from './clients/google/google-pub-sub-client.config';
import OrderingPubSubService from './ordering-pub-sub.abstract';
import PubsubServiceMock from './clients/mock/pubsub-service.mock';

export const {
  ConfigurableModuleClass,
  MODULE_OPTIONS_TOKEN: PUB_SUB_MODULE_OPTIONS_TOKEN,
  OPTIONS_TYPE: PUB_SUB_MODULE_OPTIONS_TYPE,
  ASYNC_OPTIONS_TYPE: PUB_SUB_MODULE_OPTIONS_ASYNC,
} = new ConfigurableModuleBuilder<PubSubModuleOptions[]>()
  .setExtras<{ injectKeys: symbol[] }>({ injectKeys: [] })
  .build();

/**
 * This global module bootstraps Pub/Sub infrastructure, currently supports only Google Pub/Sub client.
 * Allowing other modules to publish and subscribe to events by using the EventAccessor service.
 * This module is also responsible to create the topics and subscriptions once it inits.
 * in addition, this module is completely encapsulated and it has no reference to the other modules. In a theory, it can easily be moved to an npm package without changing a single line of code.
 */
@Global()
@Module({
  imports: [ConfigModule.forFeature(googlePubSubClientConfig), DiscoveryModule],
})
export default class PubSubModule extends ConfigurableModuleClass {
  static register(options: typeof PUB_SUB_MODULE_OPTIONS_TYPE): DynamicModule {
    const providers = (options || []).map((option) => ({
      provide: option.injectKey,
      useFactory: (client: OrderingPubSubService, logger: PinoLogger, discover: DiscoveryService): PubSubService => {
        return new PubSubService(option.topicWithSubscriptions, logger, client, discover);
      },
      inject: [
        process.env.PUBSUB_MOCK === 'true' ? PubsubServiceMock : GooglePubSubClientService,
        PinoLogger,
        DiscoveryService,
      ],
    }));

    const baseRegister = super.register(options);
    const fullRegister = [
      ...(baseRegister.providers || []),
      process.env.PUBSUB_MOCK === 'true' ? PubsubServiceMock : GooglePubSubClientService,
      ...providers,
    ];
    return {
      ...baseRegister,
      providers: fullRegister,
      exports: fullRegister,
    };
  }

  static registerAsync(asyncOptions: typeof PUB_SUB_MODULE_OPTIONS_ASYNC): DynamicModule {
    const { injectKeys } = asyncOptions;
    if (!injectKeys || injectKeys.length === 0) {
      throw new Error(`Missing injectKeys, Can't register the module`);
    }

    const providers = injectKeys.map((injectKey: symbol) => ({
      provide: injectKey,
      useFactory: (
        client: OrderingPubSubService,
        logger: PinoLogger,
        moduleOptions: PubSubModuleOptions[],
        discover: DiscoveryService,
      ): PubSubService => {
        const providerOption = moduleOptions.find((moduleOption) => moduleOption.injectKey === injectKey);
        if (!providerOption) throw new Error(`Missing inject key, Can't register the module`);
        return new PubSubService(providerOption?.topicWithSubscriptions, logger, client, discover);
      },
      inject: [
        process.env.PUBSUB_MOCK === 'true' ? PubsubServiceMock : GooglePubSubClientService,
        PinoLogger,
        PUB_SUB_MODULE_OPTIONS_TOKEN,
        DiscoveryService,
      ],
    }));

    const baseRegister = super.registerAsync(asyncOptions);
    const fullRegister = [
      ...(baseRegister.providers || []),
      process.env.PUBSUB_MOCK === 'true' ? PubsubServiceMock : GooglePubSubClientService,
      ...providers,
    ];
    return {
      ...baseRegister,
      providers: fullRegister,
      exports: fullRegister,
    };
  }
}
