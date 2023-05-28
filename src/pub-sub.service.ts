import { DiscoveryService } from '@golevelup/nestjs-discovery';
import { OnModuleInit } from '@nestjs/common';
import _groupBy from 'lodash/groupBy';
import { PinoLogger } from 'nestjs-pino';
import pRetry from 'p-retry';
import { SUBSCRIPTION_TO_HANDLER, SubscribeOptions } from './decorators/register-ordering-topics.decorator';
import OrderingPubSubService from './ordering-pub-sub.abstract';
import { EventOptions, MessageHandler } from './pub-sub.model';

export default class PubSubService implements OnModuleInit {
  constructor(
    private readonly eventOptions: EventOptions,
    private readonly logger: PinoLogger,
    private readonly pubSubClient: OrderingPubSubService,
    private readonly discover: DiscoveryService,
  ) {
    this.logger.setContext(PubSubService.name);
  }

  async onModuleInit() {
    const { topic, subscriptions } = this.eventOptions;
    const initTopicsAndSubscriptions = async () => {
      this.logger.info('Init topics and their subscriptions');
      if (!topic) {
        this.logger.error(`Can't find any topics to work with`);
        throw new Error(`Can't find any topics to work with`);
      }

      // Creating the dead letters topics, has to be done before creating the real topic
      await this.createDeadLetterTopicsIfNeeded();

      // Creating the topics and subscriptions
      await this.pubSubClient.createTopicWithSubscriptionsIfNonExist(topic, subscriptions);

      // Register to all the subscriber methods (registered by @SubscribeTo decorator)
      // has to be done only after the topics and subscriptions are successfully created
      await this.registerSubscribers();
      this.logger.debug(
        { topic, subscriptions },
        `Successfully init Pub/Sub service for topic: '${topic}' with subscriptions`,
      );
    };
    try {
      await pRetry(initTopicsAndSubscriptions, {
        retries: 5,
        onFailedAttempt: async (e) => {
          this.logger.warn(
            `failed attempt (${e.attemptNumber}) to init the pub-sub service with error ${e.stack || e.message}`,
          );
        },
      });
    } catch (error) {
      this.logger.error(
        { topic, subscriptions, error },
        `Failed to init Pub/Sub service for topic: '${topic}' with subscriptions`,
      );
      throw error;
    }
  }

  // TODO: add format checker/deserializer for the given event
  async publish(event: any): Promise<string> {
    const { topic, orderingKey } = this.eventOptions;
    return this.pubSubClient.publishEvent(topic, orderingKey, event);
  }

  async subscribeEvent(
    subscriptionName: string,
    messageHandler: MessageHandler<any>,
    filterEventTypes?: string[],
  ): Promise<void> {
    await this.pubSubClient.subscribeEvent(subscriptionName, messageHandler, filterEventTypes);
  }

  /**
   * Subscribe to all registered methods (which registered by @SubscribeTo decorator)
   * Inspired from nestJS rabbitMQ implementation:
   * https://github.com/golevelup/nestjs/blob/45afeb7ea8b6cc82ff9ccb64afa65fb59c64744d/packages/rabbitmq/src/rabbitmq.module.ts#L152
   * https://github.com/golevelup/nestjs/blob/45afeb7ea8b6cc82ff9ccb64afa65fb59c64744d/packages/rabbitmq/README.md
   *
   */
  private async registerSubscribers() {
    const eventSubscribersMetadata = await this.discover.providerMethodsWithMetaAtKey<SubscribeOptions>(
      SUBSCRIPTION_TO_HANDLER,
    );

    const grouped = _groupBy(
      eventSubscribersMetadata,
      (eventSubscriberMetadata) => eventSubscriberMetadata.discoveredMethod.parentClass.name,
    );

    const providerKeys = Object.keys(grouped);

    // eslint-disable-next-line no-restricted-syntax
    for (const key of providerKeys) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(
        grouped[key].map(async ({ discoveredMethod, meta: config }) => {
          const { subscriptionName, eventTypes } = config;
          const fullSubscriptionName = this.getFullSubscriptionName(subscriptionName);
          if (
            !this.eventOptions.subscriptions.find(
              (subscription) => subscription.subscriptionName === fullSubscriptionName,
            )
          ) {
            this.logger.error(
              { fullSubscriptionName },
              `Seems like we are trying to subscribe to unregister subscription, the subscription might be non-exist. make sure you've correctly added it by using the 'register/registerAsync' method provided by the 'pub-sub.module'. subscriptionName: ${subscriptionName}`,
            );
            throw new Error(`Unregistered subscription name: '${fullSubscriptionName}'`);
          }

          const originalHandler = discoveredMethod.handler.bind(discoveredMethod.parentClass.instance);
          return this.subscribeEvent(fullSubscriptionName, originalHandler, eventTypes);
        }),
      );
    }
  }

  private async createDeadLetterTopicsIfNeeded() {
    // Get dead letter topic names
    const deadLetterTopicNames = new Set<string>();
    this.eventOptions.subscriptions.forEach((subscription) => {
      const deadLetterTopic = subscription.createSubscriptionOptions?.deadLetterPolicy?.deadLetterTopic;
      if (deadLetterTopic) {
        deadLetterTopicNames.add(deadLetterTopic);
      }
    });

    await Promise.all(
      [...deadLetterTopicNames].map((name) =>
        this.pubSubClient.createTopicWithSubscriptionsIfNonExist(
          name,
          [
            {
              subscriptionName: `${name}-subscription`,
            },
          ],
          true,
        ),
      ),
    );
  }

  private getFullSubscriptionName(subscription: string): string {
    const { prefix } = this.eventOptions;
    return `${prefix}-${subscription}`;
  }
}
