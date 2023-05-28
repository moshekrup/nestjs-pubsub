import { CreateSubscriptionOptions as GoogleCreateSubscriptionOptions } from '@google-cloud/pubsub';

export type CreateSubscriptionOptions = GoogleCreateSubscriptionOptions;

export type SubscriptionOptions = {
  subscriptionName: string;
  createSubscriptionOptions?: CreateSubscriptionOptions;
};

export type EventOptions = {
  topic: string;
  prefix: string; // Prefix for the all module object names (subscriptions and topics)
  orderingKey: string;
  subscriptions: SubscriptionOptions[];
};

export type PubSubModuleOptions = {
  injectKey: string | symbol;
  topicWithSubscriptions: EventOptions;
};

export type MessageHandler<T = any> = (message: T) => Promise<void>;
