import OrderingPubSubService from 'src/event-management/pub-sub/ordering-pub-sub.abstract';
import { SubscriptionOptions, MessageHandler } from 'src/event-management/pub-sub/pub-sub.model';

type SubscriptionMock = {
  subscriptionName: string;
  messageHandler?: MessageHandler<any>;
  filterEventTypes?: string[] | undefined;
};

export default class PubsubServiceMock extends OrderingPubSubService {
  private topics: Record<string, SubscriptionMock[]> = {};

  logger = console;

  async createTopicWithSubscriptionsIfNonExist(
    topic: string,
    subscriptions: SubscriptionOptions[],
    _isDeadLetterTopic?: boolean | undefined,
  ): Promise<void> {
    if (!this.topics[topic]) {
      this.topics[topic] = subscriptions.map(({ subscriptionName }) => ({ subscriptionName }));
    }
  }

  async publishEvent(topic: string, orderingKey: string, event: { type: string }): Promise<string> {
    const eventHandlers = this.topics[topic]?.filter((subscriptions) =>
      subscriptions.filterEventTypes?.includes(event.type),
    );
    eventHandlers.forEach(({ messageHandler }) => {
      if (messageHandler) {
        messageHandler(event).catch((e) => this.logger.log(e));
      }
    });
    return event.type;
  }

  async subscribeEvent(
    subscriptionNameForEvent: string,
    messageHandler: MessageHandler<any>,
    filterEventTypes?: string[] | undefined,
  ): Promise<void> {
    const topics = Object.values(this.topics);
    topics.forEach((subscriptions) => {
      const subscription = subscriptions.find(({ subscriptionName }) => subscriptionName === subscriptionNameForEvent);
      if (subscription) {
        subscription.messageHandler = messageHandler;
        subscription.filterEventTypes = filterEventTypes;
      }
    });
  }

  // eslint-disable-next-line class-methods-use-this, @typescript-eslint/no-empty-function
  async close(): Promise<void> {}
}
