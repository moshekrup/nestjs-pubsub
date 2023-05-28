# nestjs-pubsub

A powerful and easy-to-use Google Pub/Sub wrapper module for NestJS, designed to streamline integration with the official TypeScript client.

## Table of Contents

- [Installation](#installation)
- [Usage](#usage)
- [Configuration](#configuration)
- [Mocking](#mocking)

## Installation

To install the package, simply run:

```bash
npm install nestjs-pubsub
```

or

```bash
yarn add nestjs-pubsub
```

## Usage

First, import the `PubSubModule` in your `AppModule` and call the `register()` or `registerAsync()` method along with configuration options:

```typescript
import { Module } from '@nestjs/common';
import PubSubModule from 'nestjs-pubsub';

@Module({
  imports: [
    // Replace with your own configuration
    PubSubModule.register([...]),
  ],
})
export class AppModule {}
```

## Configuration

The `register()` method accepts an array of `PubSubModuleOptions` objects. Each object must contain an `injectKey` symbol and a `topicWithSubscriptions` array.

Example:

```typescript
import { PubSubModule } from 'nestjs-pubsub';

// Define your inject keys
export const MyInjectKey = Symbol('MyInjectKey');

// Register the module with your options
@Module({
  imports: [
    PubSubModule.register([
      {
        injectKey: MyInjectKey,
        topicWithSubscriptions: {
          topic: 'my-topic',
          subscription: 'my-subscription'
        },
      },
    ]),
  ],
})
export class AppModule {}
```

Or use the `registerAsync()` method to register the module with async options:

```typescript
import { PubSubModule } from 'nestjs-pubsub';

// Define your inject keys
export const MyInjectKey = Symbol('MyInjectKey');

// Register the module with async options
@Module({
  imports: [
    PubSubModule.registerAsync({
      injectKeys: [MyInjectKey],
      useFactory: async () => [
        {
          injectKey: MyInjectKey,
          topicWithSubscriptions: {
            topic: 'my-topic',
            subscription: 'my-subscription',
          },
        },
      ],
    }),
  ],
})
export class AppModule {}
```

Of course you can provide any configurations as you wish

```typescript
import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  EVENTS_ORDERING_KEY,
  PUB_SUB_EVENTS_KEY,
  ServiceSubscriptionName,
} from './event-management.const';
import pubSubConfig, { PubSubConfig } from './pub-sub/pub-sub.config';
import PubSubModule from './pub-sub/pub-sub.module';

@Global()
@Module({
  imports: [
    PubSubModule.registerAsync({
      useFactory: (config: PubSubConfig) => {
        // Example of using advance configuration
        const useRetryAndDeadLetterPolicy =
          config.SERVER_SERVICE_ACCOUNT_SECRET && config.PUB_SUB_API_ENDPOINT;
        const getFullName = (name: string) => {
          return `${config.PUB_SUB_TOPIC_SUBSCRIPTION_PREFIX}-${name}`;
        };

        const createSubscriptionOptions = {
          messageRetentionDuration: config.PUB_SUB_RETENTION_DURATION_MESSAGE,
          retainAckedMessages: config.PUB_SUB_RETENTION_ACKED_MESSAGE === 'true',
          ackDeadlineSeconds: config.PUB_SUB_RETENTION_ACK_DEADLINE,
          ...(useRetryAndDeadLetterPolicy && {
            deadLetterPolicy: {
              maxDeliveryAttempts: config.MAX_NUMBER_OF_DELIVERY_ATTEMPTS,
              deadLetterTopic: getFullName(config.PUB_SUB_DEAD_LETTER_TOPIC_NAME),
            },
            retryPolicy: {
              minimumBackoff: { seconds: config.PUB_SUB_RETRY_POLICY_MINIMUM_BACKOFF_SECOND },
              maximumBackoff: { seconds: config.PUB_SUB_RETRY_POLICY_MAXIMUM_BACKOFF_SECOND },
            },
          }),
        };

        return [
          {
            injectKey: PUB_SUB_EVENTS_KEY,
            topicWithSubscriptions: {
              topic: getFullName(config.PUB_SUB_TOPIC_NAME),
              prefix: config.PUB_SUB_TOPIC_SUBSCRIPTION_PREFIX,
              orderingKey: EVENTS_ORDERING_KEY,
              subscriptions: Object.values(ServiceSubscriptionName).map((subscriptionName) => ({
                subscriptionName: getFullName(subscriptionName),
                // Advance optional configuration, not mandatory, see the section below
                createSubscriptionOptions,
              })),
            },
          },
        ];
      },
      injectKeys: [PUB_SUB_EVENTS_KEY],
      inject: [pubSubConfig.KEY],
      imports: [ConfigModule.forFeature(pubSubConfig)],
    }),
  ],
})
export default class EventManagementModule {}
```

In the example provided, the `createSubscriptionOptions` object is used to set specific configuration options for the subscriptions. It's important to note that `createSubscriptionOptions` is not mandatory, and you can choose to omit it if you don't need to customize any subscription options.

Moreover, the `createSubscriptionOptions` object can accept any supported configuration options from the official [Google Pub/Sub client](https://github.com/googleapis/nodejs-pubsub). This allows you to use the full range of available options provided by the Google Pub/Sub client when setting up your subscriptions.

Please refer to the Google Pub/Sub client's [official documentation](https://googleapis.dev/nodejs/pubsub/latest/global.html#CreateSubscriptionOptions) to explore all available configuration options that you can use within the `createSubscriptionOptions` object.

In the given example, you can modify the `createSubscriptionOptions` object to include or remove specific options according to your requirements:

```typescript
const createSubscriptionOptions = {
  messageRetentionDuration: config.PUB_SUB_RETENTION_DURATION_MESSAGE,
  retainAckedMessages: config.PUB_SUB_RETENTION_ACKED_MESSAGE === 'true',
  ackDeadlineSeconds: config.PUB_SUB_RETENTION_ACK_DEADLINE,
  // add or remove any other options supported by the Google Pub/Sub client
  // ...
};
```

Remember to adjust your application's configuration accordingly to match the options you have included in the `createSubscriptionOptions` object.


## Publishing Events

The `publish` function allows you to publish an event to a specified topic using the Pub/Sub client. In this section, we'll go through how to use the `publish` function in detail.

### Prerequisites

Before using the `publish` function, please ensure that the `nestjs-pubsub` module is correctly set up and configured in your NestJS application. Refer to the [Configuration](#configuration) section for more information.

### Using the `publish` function

To use the `publish` function, follow these steps:

1. Inject the `PubSubService` in a provider where you want to use it.
   ```typescript
   import { Injectable } from '@nestjs/common';
   import { PubSubService } from 'nestjs-pubsub';

   @Injectable()
   export class MyService {
     constructor(private readonly pubSubService: PubSubService) {}
   }
   ```
2. Prepare the event object you want to publish. This object should contain all the necessary data related to the event, such as message content or payload, timestamp, and any other relevant information.

3. Call the `publish` function, and pass the event object as an argument.
   ```typescript
   async publishEvent(event: any): Promise<string> {
     return this.pubSubService.publish(event);
   }
   ```
4. The function returns a `Promise` that resolves to a `string` representing the message ID of the published message.

Here's a simple example of how to use the `publish` function:

```typescript
// my.service.ts
import { Injectable } from '@nestjs/common';
import { PubSubService } from 'nestjs-pubsub';

@Injectable()
export class MyService {
  constructor(private readonly pubSubService: PubSubService) {}

  async sendEvent() {
    const event = {
      message: 'Hello, World!',
      timestamp: new Date().toISOString(),
    };

    const jobId = await this.pubSubService.publish(event);
    console.log(`Event published with Message ID: ${jobId}`);
  }
}
```

In this example, the `sendEvent` function prepares an event object, publishes it using the `publish` function provided by the `PubSubService`, and logs the message ID to the console.

When publishing an event, the `publish` function uses the topic and ordering key configured in the `eventOptions`. Make sure these options are correctly set according to the topics you want to use in your application.

As of now, the `publish` function in the `nestjs-pubsub` module supports ordering message publishing, which allows messages with the same ordering key to be delivered in the order in which they were published. This feature is useful in scenarios where the order of the events is significant, such as processing transactions or updating records in a specific sequence.

## Subscribing to Events

There are two methods to subscribe to events using the `nestjs-pubsub` module: the `subscribeEvent` function and the `SubscribeTo` decorator.

### Using the `subscribeEvent` function

To subscribe to events using the `subscribeEvent` function, follow these steps:

1. Inject the `PubSubService` in a provider where you want to use it.
   ```typescript
   import { Injectable } from '@nestjs/common';
   import { PubSubService } from 'nestjs-pubsub';

   @Injectable()
   export class MyService {
     constructor(private readonly pubSubService: PubSubService) {}
   }
   ```

2. Implement the `MessageHandler` that will process the events. This function should accept a single argument with the event payload.

   ```typescript
   handleMessage(event: any): void {
     console.log(`Received event: ${JSON.stringify(event)}`);
   }
   ```

3. Call the `subscribeEvent` function, and pass the subscription name, the message handler, and an optional array of event types to filter the events.

   ```typescript
   async subscribeToEvents() {
     const subscriptionName = 'my-subscription';
     const filterEventTypes = ['eventType1', 'eventType2'];

     await this.pubSubService.subscribeEvent(
       subscriptionName,
       this.handleMessage.bind(this),
       filterEventTypes,
     );
   }
   ```

4. Call the `subscribeToEvents` function in your service's initialization code, during application startup, or whenever you want to start listening to events.

### Using the `SubscribeTo` decorator

To subscribe to events using the `SubscribeTo` decorator, follow these steps:

1. Import `SubscribeTo` decorator in the provider where you want to use it.

   ```typescript
   import SubscribeTo from 'path/to/decorator/subscribe-to';
   ```

2. Create a new method within the provider and annotate it with the `@SubscribeTo()` decorator, passing the subscription name and an optional array of event types to filter the events.

   ```typescript
   @SubscribeTo({
     subscriptionName: 'my-subscription',
     eventTypes: ['eventType1', 'eventType2'],
   })
   handleMessage(event: any): void {
     console.log(`Received event: ${JSON.stringify(event)}`);
   }
   ```

3. During module initialization, the `nestjs-pubsub` module will automatically register all methods decorated with `@SubscribeTo()` as listeners for their respective subscriptions, as long as the module is correctly set up and configured in your NestJS application.

With the help of the `subscribeEvent` function or the `SubscribeTo` decorator, you can efficiently process and handle incoming events from the Google Pub/Sub service. Choose the method that best suits your application's design and requirements.

# Filters Events

The filters provided in the `subscribeEvent` function and the `SubscribeTo` decorator are applicative leven, meaning they are handled at the application level, not by Google Pub/Sub. When using these filters, the application filters the incoming events based on their types before processing them with the specified message handler.

These applicative filters are different from the filters offered directly by Google Pub/Sub, which are configured on the subscription level and filter messages before they are delivered to the subscriber. Google Pub/Sub filters provide more advanced options, such as attribute-based filtering or conditional expressions. For more information about Google Pub/Sub filters, please refer to the [official documentation](https://cloud.google.com/pubsub/docs/filtering).

The reason for using applicative filters in the `subscribeEvent` function and the `SubscribeTo` decorator is to provide more flexibility in event handling within the application. By applying filters at the application level, you can control and adjust filtering logic based on your specific requirements without relying on the built-in Google Pub/Sub filters.

However, in the future, the `nestjs-pubsub` module plans to extend its filtering capabilities by supporting Google Pub/Sub's built-in filters. This would allow you to leverage the full range of Google Pub/Sub's filtering features, including attribute-based filtering and conditional expressions, for a more robust and efficient event filtering experience.

By integrating both applicative filters and Google Pub/Sub's built-in filters, the `nestjs-pubsub` module aims to provide a comprehensive and versatile event filtering solution that caters to various application requirements and use cases.

## Coming Soon Features

The `nestjs-pubsub` module is continuously being improved to provide more features and better functionality for your NestJS applications. Here are some of the upcoming features that we are working on:

- Support for Google Pub/Sub Filters: We plan to integrate Google Pub/Sub's built-in filters for event filtering in the `nestjs-pubsub` module, allowing you to leverage a broad range of filtering features.

- Support for Non-ordering Messages: To provide additional flexibility in message publishing, we aim to support both ordered and unordered message publishing based on your application requirements.

- End-to-end (E2E) Tests: We are working to include comprehensive end-to-end tests to ensure the reliability and stability of the `nestjs-pubsub` module and its features, facilitating easier maintenance and development.

## Automatic Creation of Subscriptions

Once the module is properly configured it automatically creates topics and subscriptions based on the provided configuration.

The module performs the following tasks:

1. Log the information that the initialization of topics and subscriptions is starting.
2. Check if a topic is provided, and throw an error if no topics are found.
3. Create the dead letter topics if necessary (if it's configured).
4. Create the actual topic and its subscriptions.
5. Register all the subscriber methods (decorated with the `@SubscribeTo` decorator, see the below example) to their corresponding subscriptions.

With this automated process, you don't need to manually create topics and subscriptions in Google Pub/Sub. The system handles the setup, ensuring your application is ready to publish and subscribe to events as soon as it starts.

## API Reference

| Type / Property                | Type                                                                         | Description                                                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **PubSubModuleOptions**        |                                                                              |                                                                                                                           |
| `injectKey`                    | `string` or `symbol`                                                         | A unique injection key for the Pub/Sub service                                                                            |
| `topicWithSubscriptions`       | `EventOptions`                                                               | Configuration options for topics and subscriptions                                                                        |
| **EventOptions**               |                                                                              |                                                                                                                           |
| `topic`                        | `string`                                                                     | The name of the topic                                                                                                     |
| `prefix`                       | `string`                                                                     | Prefix for all module object names (subscriptions and topics)                                                             |
| `orderingKey`                  | `string`                                                                     | The ordering key for the messages                                                                                          |
| `subscriptions`                | `SubscriptionOptions[]`                                                      | Array of subscription configuration options                                                                               |
| **SubscriptionOptions**        |                                                                              |                                                                                                                           |
| `subscriptionName`             | `string`                                                                     | The name of the subscription                                                                                              |
| `createSubscriptionOptions`    | `CreateSubscriptionOptions` (optional)                                      | Additional configuration options for the subscription (from the official Google Pub/Sub client)                           |
| **CreateSubscriptionOptions** |                                                                              |                                                                                                                           |
| `ackDeadlineSeconds`           | `number` (optional)                                                          | The number of seconds between attempts to renew a message lease                                                           |
| `deadLetterPolicy`             | `{ deadLetterTopic: string; maxDeliveryAttempts: number }` (optional)       | The dead letter policy configuration, with the dead letter topic and max delivery attempts                                |
| `filter`                       | `string` (optional)                                                          | A filter to apply to the subscription, using the Google Pub/Sub filtering syntax                                          |
| `labels`                       | `Record<string, string>` (optional)                                         | Key-value pairs to apply to the subscription                                                                              |
| `messageRetentionDuration`     | `number` or `{seconds: number; nanos?: number}` (optional)                  | The number of seconds to retain acknowledged messages or an object with `seconds` and optional `nanos` properties        |
| `pushConfig`                   | `{ pushEndpoint: string; oidcToken: { serviceAccountEmail: string } } ` (optional) | Configuration for push delivery of messages, including push endpoint and optional OIDC token with service account email |
| `retainAckedMessages`          | `boolean` (optional)| Set to `true` to retain acknowledged messages (note that this must be used with `messageRetentionDuration`)             |
| `retryPolicy`                  | `{ maximumBackoff: {seconds: number; nanos?: number}; minimumBackoff: {seconds: number; nanos?: number} }` (optional) | Configuration for retry policy, specifying maximum and minimum backoff periods in seconds (and optional nanoseconds)   |

This table summarizes the various types and properties that you can use to configure the `nestjs-pubsub` module in your application. All options listed are based on the available configurations provided by the official Google Pub/Sub client. For more information and examples of using these options, you can refer to the [official Google Pub/Sub documentation](https://googleapis.dev/nodejs/pubsub/latest/global.html#CreateSubscriptionOptions).

## Mocking

You can enable mocking by setting the `PUBSUB_MOCK` environment variable to `'true'`. This will inject the `PubsubServiceMock` class instead of the `GooglePubSubClientService`:

```bash
export PUBSUB_MOCK=true
```

Or add it to your `.env` file:

```dotenv
PUBSUB_MOCK=true
```

This can be useful for testing or local development without depending on the actual Google Pub/Sub service.

## License

This project is licensed under the [MIT License](LICENSE).