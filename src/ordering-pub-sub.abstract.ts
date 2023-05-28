import { MessageHandler, SubscriptionOptions } from './pub-sub.model';

export default abstract class OrderingPubSubService {
  abstract createTopicWithSubscriptionsIfNonExist(
    topic: string,
    subscriptions: SubscriptionOptions[],
    isDeadLetterTopic?: boolean,
  ): Promise<void>;
  abstract publishEvent(topic: string, orderingKey: string, event: unknown): Promise<string>;
  abstract subscribeEvent(
    subscriptionName: string,
    messageHandler: MessageHandler,
    filterEventTypes?: string[],
  ): Promise<void>;
  abstract close(): Promise<void>;
}
