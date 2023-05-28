import { GetSubscriptionMetadataResponse, Message, PubSub, Subscription, Topic } from '@google-cloud/pubsub';
import { Inject, OnModuleDestroy } from '@nestjs/common';
import { getConfigToken } from '@nestjs/config';
import { GoogleAuth } from 'google-auth-library';
import _isEqual from 'lodash/isEqual';
import _isMatch from 'lodash/isMatch';
import { PinoLogger } from 'nestjs-pino';
import { PublishMessage } from 'src/event-management/event-management.model';
import OrderingPubSubService from '../../ordering-pub-sub.abstract';
import { CreateSubscriptionOptions, MessageHandler, SubscriptionOptions } from '../../pub-sub.model';
import GooglePubSubClientConfigInterface, {
  GOOGLE_PUB_SUB_CLIENT_CONFIG_KEY,
} from './google-pub-sub-client-config.interface';

// According to official doc there's a limit related to number of subscriptions per client instance
// https://cloud.google.com/nodejs/docs/reference/pubsub/latest/pubsub/subscription
const MAX_SUBSCRIPTIONS_PER_CLIENT = 10;

enum GooglePubSubRole {
  PUBLISHER = 'roles/pubsub.publisher',
  SUBSCRIBER = 'roles/pubsub.subscriber',
}

const NO_SUBSCRIPTION_CLIENT = '__NO_SUBSCRIPTION_CLIENT';

export default class GooglePubSubClientService extends OrderingPubSubService implements OnModuleDestroy {
  private pubSubClientsMap: Record<string, PubSub>;

  private pubSubClients: PubSub[];

  private subscriptionsToClean: Subscription[] = [];

  constructor(
    @Inject(getConfigToken(GOOGLE_PUB_SUB_CLIENT_CONFIG_KEY))
    private readonly config: GooglePubSubClientConfigInterface,
    private readonly logger: PinoLogger,
  ) {
    super();
    this.logger.setContext(GooglePubSubClientService.name);

    /**
     * See comment of the method "createAndGetPubSubClient" regarding why it is needed.
     */
    this.pubSubClientsMap = {};
    this.pubSubClients = [];
  }

  async close(): Promise<void> {
    this.subscriptionsToClean.forEach((sub) => sub.removeAllListeners());
    await Promise.all(this.pubSubClients.map((pubSubClient) => pubSubClient.close()));
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.info('Closing the google pub/sub connection');
    await this.close();
    this.logger.info('Gracefully closed the google pub/sub connection');
  }

  /**
   * Note:
   * The Google client is automatically handling the retry policy. Reference: https://cloud.google.com/pubsub/docs/publisher#retry
   *
   * @param topic The topic name to send to
   * @param orderingKey ordering key for keeping message order
   * @param event the event as json
   * @returns message id as string
   */
  override async publishEvent(topic: string, orderingKey: string, event: unknown): Promise<string> {
    this.logger.debug({ topic }, `Publishing event to topic ${topic}`);

    const pubSubClient = this.createAndGetPubSubClient();
    let topicResponse: Topic | null = null;

    try {
      this.logger.debug({ event, topic }, `getting topic`);
      [topicResponse] = await pubSubClient.topic(topic).get();
      this.logger.debug({ event, topic }, `got topic, publishing message`);
      const messageId = await topicResponse.publishMessage({ data: Buffer.from(JSON.stringify(event)), orderingKey });
      this.logger.debug(
        { event, topic, messageId },
        `Successfully published a message to topic: ${topic}, messageId: ${messageId} `,
      );
      return messageId;
      // Reference: https://cloud.google.com/pubsub/docs/publisher#retry_ordering
    } catch (error) {
      this.logger.error({ event, topic }, `An error ocurred while publishing event: ${event} to topic ${topic}`);

      if (topicResponse) {
        topicResponse.resumePublishing(orderingKey);
      }

      throw error; // Should we need to throw here?
    }
  }

  /**
   *
   * TODO: better error handling
   * TODO: Configure dead letter policy
   * @param subscriptionName The id subscription, must be a unique for the entire project
   * @param messageHandler The handler function which will be called once a new message has arrived
   * @param filterEventTypes Filter the events by this array (only the described events will be sent to the subscriber)
   */
  override async subscribeEvent(
    subscriptionName: string,
    messageHandler: MessageHandler,
    filterEventTypes?: string[],
    removeExistingHandlers = false,
  ): Promise<void> {
    const pubSubClient = this.createAndGetPubSubClient(subscriptionName);
    const [subscription] = await pubSubClient.subscription(subscriptionName).get();

    if (removeExistingHandlers) {
      subscription.removeAllListeners('message');
    }
    // These event listeners need to be cleaned otherwise they leak.
    // when querying the client for all subscriptions we don't get the same logical instance with its listeners.
    // so instead, we save them in an array for cleanup later.
    this.subscriptionsToClean.push(subscription);

    subscription.on('message', async (event: Message) => {
      await this.handleEvent(subscriptionName, event, messageHandler, filterEventTypes);
    });

    subscription.on('error', (error) => {
      this.logger.error(
        { subscriptionName, error },
        `An error ocurred while listening to subscription: ${subscriptionName}`,
      );
    });
  }

  private async handleEvent(
    subscriptionName: string,
    event: Message,
    messageHandler: MessageHandler,
    filterEventTypes?: string[],
  ) {
    this.logger.trace(
      { subscriptionName },
      `Getting a new event for subscription: ${subscriptionName}. Delivery attempt: ${event.deliveryAttempt} / ${this.config.MAX_NUMBER_OF_DELIVERY_ATTEMPTS}`,
    );
    this.logger.trace({ subscriptionName, event: event.data.toString() }, 'Original event');
    try {
      this.logger.trace({ subscriptionName, event: event.data.toString() }, 'parsing message');
      const jsonEvent = this.parseEvent(event);
      this.logger.trace(
        { subscriptionName, event: event.data.toString(), parsed: jsonEvent },
        'Successfully parsed message',
      );
      if (!jsonEvent) {
        this.logger.info(
          { subscriptionName },
          `Incorrect json format, Skipping handling for the subscription: ${subscriptionName}`,
        );
        event.ack();
        this.logger.trace({ subscriptionName }, 'message acked');
        return;
      }
      const { type: eventType } = jsonEvent;
      /**
       * Skip on:
       * 1) filtered events
       * 2) event without type if filterEventTypes is provided
       */
      if (
        (!eventType && filterEventTypes && filterEventTypes.length > 0) ||
        (filterEventTypes && !filterEventTypes.includes(eventType))
      ) {
        this.logger.trace(
          { eventType, filterEventTypes, jsonEvent, subscriptionName },
          `The event is filtered by the subscriber. Skipping handling for the subscription: ${subscriptionName}`,
        );
        event.ack();
        this.logger.trace({ subscriptionName }, 'message acked');
        return;
      }
      this.logger.trace(
        { subscriptionName, event: event.data.toString(), parsed: jsonEvent },
        'running message handler',
      );
      await messageHandler(jsonEvent);
      this.logger.trace({ subscriptionName, event: event.data.toString(), parsed: jsonEvent }, 'trying to ack message');
      event.ack();
      this.logger.trace({ subscriptionName }, 'message acked');
    } catch (error) {
      this.logger.error(
        { subscriptionName, error },
        `An error ocurred while listening to subscription: ${subscriptionName}`,
      );
      event.nack();
      this.logger.trace({ subscriptionName }, 'message nacked');
    }
  }

  override async createTopicWithSubscriptionsIfNonExist(
    topic: string,
    subscriptions: SubscriptionOptions[],
    isDeadLetterTopic = false,
  ): Promise<void> {
    this.logger.debug(
      { topic, subscriptions },
      `Creating a topic: ${topic} ${subscriptions.length > 0 && 'with subscriptions'}`,
    );

    /**
     * To avoid a race condition of creating the topic, we create it once using the default PubSub client
     */
    await this.getOrCreateTopic(this.createAndGetPubSubClient(), topic, isDeadLetterTopic);

    if (subscriptions.length === 0) return;
    const subscriptionPromises = subscriptions.map(async ({ subscriptionName, createSubscriptionOptions }) => {
      const pubSubClient = this.createAndGetPubSubClient(subscriptionName);

      /**
       * Since the topic was already created outside the loop, it will just get it,
       * avoiding a race condition where multiple clients try to create the same topic.
       */
      const topicResponse = await this.getOrCreateTopic(pubSubClient, topic, isDeadLetterTopic);

      return this.getOrCreateSubscriptionForTopic(topicResponse, subscriptionName, createSubscriptionOptions);
    });

    await Promise.all(subscriptionPromises);
  }

  private parseEvent(event: Message) {
    try {
      this.logger.trace('Parsing the event...');
      const jsonEvent: PublishMessage = JSON.parse(event.data.toString());
      this.logger.trace({ jsonEvent }, `Successfully parsed the event`);
      return jsonEvent;
    } catch (error) {
      this.logger.warn({ error }, 'Failed to parse the event');
      return null;
    }
  }

  private async getOrCreateTopic(pubSubClient: PubSub, topic: string, isDeadLetterTopic: boolean): Promise<Topic> {
    const topicResponse = pubSubClient.topic(topic, { messageOrdering: true });
    const [isTopicExist] = await topicResponse.exists();
    let topicResult;
    if (isTopicExist) {
      this.logger.debug({ topic }, `Given topic: '${topic}' already exist. Skipping to create...`);
      [topicResult] = await topicResponse.get();
    } else {
      this.logger.debug({ topic }, `Given topic: '${topic}' doesn't exist. creating a new topic: '${topic}'`);
      [topicResult] = await topicResponse.create();
      this.logger.info({ topic }, `Successfully created a new topic: ${topic}`);
    }

    if (isDeadLetterTopic) {
      await this.updatePolicyForDeadLetter(topic, topicResult, GooglePubSubRole.PUBLISHER);
    }

    return topicResult;
  }

  // Checkout: https://cloud.google.com/pubsub/docs/handling-failures#grant_forwarding_permissions
  private getPolicyForDefaultGoogleServiceAccount(role: GooglePubSubRole) {
    return {
      condition: null,
      role,
      members: [`serviceAccount:service-${this.config.GCP_PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com`],
    };
  }

  private getSubscriptionOptions(pubSubClient: PubSub, subscriptionOptions?: CreateSubscriptionOptions) {
    this.logger.debug({ subscriptionOptions }, 'Getting subscription options');

    const { deadLetterPolicy } = subscriptionOptions || {};
    const hasDeadLetterPolicy = !!deadLetterPolicy;

    return {
      ...subscriptionOptions,
      ...(hasDeadLetterPolicy && {
        deadLetterPolicy: {
          ...deadLetterPolicy,
          // Extract the full topic name (`projects/projectId/subscriptions/subscriptionName`)
          deadLetterTopic: pubSubClient.topic(deadLetterPolicy!.deadLetterTopic!).name,
        },
      }),
    };
  }

  // Set policy in case of the subscription has a dead letter policy
  // Checkout https://cloud.google.com/pubsub/docs/handling-failures#grant_forwarding_permissions
  private async updatePolicyForDeadLetter(
    topicOrSubscriptionName: string,
    topicOrSubscription: Subscription | Topic,
    setRole: GooglePubSubRole,
  ): Promise<void> {
    const policy = this.getPolicyForDefaultGoogleServiceAccount(setRole);
    const [currentPolicy] = await topicOrSubscription.iam.getPolicy();
    const currentPolicyHasDeadLetterPermission = currentPolicy.bindings?.find((bindingPolicy) =>
      _isEqual(bindingPolicy, policy),
    );

    if (currentPolicyHasDeadLetterPermission) {
      this.logger.info(
        { policy, topicOrSubscriptionName },
        `The subject already granted permission for '${setRole}', skipping...`,
      );
      return;
    }

    this.logger.info(
      { policy, topicOrSubscriptionName },
      `Set policy for the subscription with '${GooglePubSubRole.SUBSCRIBER}'`,
    );
    const bindings = [...(currentPolicy.bindings || []), policy];
    await topicOrSubscription.iam.setPolicy({
      ...currentPolicy,
      bindings,
    });
  }

  private async getOrCreateSubscriptionForTopic(
    topic: Topic,
    subscriptionName: string,
    subscriptionOptions?: CreateSubscriptionOptions,
  ): Promise<void> {
    const pubSubClient = this.createAndGetPubSubClient(subscriptionName);
    const [existedSubscriptionsResponse] = await topic.getSubscriptions();

    const subscriptionOptionsWithDeadLetter = this.getSubscriptionOptions(pubSubClient, subscriptionOptions);

    let resultSubscription = existedSubscriptionsResponse.find(
      (subscription) => subscription.name === `projects/${pubSubClient.projectId}/subscriptions/${subscriptionName}`,
    );

    // Check if the subscription already exist
    if (resultSubscription) {
      this.logger.debug(
        { subscriptionName },
        `Given subscription: '${subscriptionName}' already exist. Skipping to create...`,
      );

      if (subscriptionOptions) {
        const currentMetaData = await resultSubscription.getMetadata();
        if (GooglePubSubClientService.isMetadataChanged(currentMetaData, subscriptionOptionsWithDeadLetter)) {
          this.logger.debug({ subscriptionOptionsWithDeadLetter }, 'Updating the subscription metadata');
          await resultSubscription.setMetadata(subscriptionOptionsWithDeadLetter);
        } else {
          this.logger.debug(
            { subscriptionOptionsWithDeadLetter },
            "Subscription metadata isn't changed, skipping updating metadata...",
          );
        }
      }
    } else {
      // The subscription doesn't exist, create a new one
      this.logger.info(
        { subscriptionName, subscriptionOptions },
        `Given subscription: ${subscriptionName} doesn't exist. creating a new one: '${subscriptionName}' for a topic: '${topic.name}'`,
      );

      [resultSubscription] = await topic.createSubscription(subscriptionName, {
        enableMessageOrdering: true,
        ...subscriptionOptionsWithDeadLetter,
      });

      this.logger.info({ subscriptionName }, `Successfully created a new subscription: ${subscriptionName}`);
    }

    // Set policy in case of the subscription has a dead letter policy
    // Checkout https://cloud.google.com/pubsub/docs/handling-failures#grant_forwarding_permissions
    if (subscriptionOptions?.deadLetterPolicy) {
      await this.updatePolicyForDeadLetter(subscriptionName, resultSubscription, GooglePubSubRole.SUBSCRIBER);
    }
  }

  /**
   * Due to the PubSub library limitation on the amount of open streams it can handle per client instance
   * We need to create multiple instances due to the amount of subscriptions we have
   * reference: https://cloud.google.com/nodejs/docs/reference/pubsub/latest/pubsub/subscription
   *
   * This function will create a new instance if it doesn't exist and the number of associated subscriptions are lower than MAX_SUBSCRIPTIONS_PER_CLIENT and return it
   * If no subscription name was provided, it'll return a default client
   */
  private createAndGetPubSubClient(subscriptionName: string = NO_SUBSCRIPTION_CLIENT) {
    if (!this.pubSubClientsMap[subscriptionName]) {
      /**
       * We must provide the exactly region since we use ordering capability
       * Reference: https://cloud.google.com/pubsub/docs/publisher#using-ordering-keys
       */
      const { PUB_SUB_API_ENDPOINT, SERVER_SERVICE_ACCOUNT_SECRET } = this.config;

      if (PUB_SUB_API_ENDPOINT) {
        const credentialsFileRaw = Buffer.from(SERVER_SERVICE_ACCOUNT_SECRET!, 'base64').toString();
        const credentialsFile = JSON.parse(credentialsFileRaw);

        const currentSubscriptionsCount = Object.keys(this.pubSubClientsMap).length;
        const leaderIndex = Math.floor(Math.abs(currentSubscriptionsCount / MAX_SUBSCRIPTIONS_PER_CLIENT));
        const client = this.pubSubClients[leaderIndex];
        if (client) {
          this.logger.debug({ subscriptionName, leaderIndex, currentSubscriptionsCount }, 'Using an existed instance');
          this.pubSubClientsMap[subscriptionName] = client;
        } else {
          this.logger.debug(
            { subscriptionName, leaderIndex, currentSubscriptionsCount },
            'Creating a new Pub/Sub instance',
          );
          const auth = new GoogleAuth({
            credentials: {
              client_email: credentialsFile.client_email,
              private_key: credentialsFile.private_key,
            },
            projectId: credentialsFile.project_id,
          });
          this.pubSubClients[leaderIndex] = new PubSub({
            auth,

            // We must provide the exactly region since we use ordering capability, checkout the above comment
            apiEndpoint: PUB_SUB_API_ENDPOINT,
            projectId: credentialsFile.project_id,
          });
        }
        this.pubSubClientsMap[subscriptionName] = this.pubSubClients[leaderIndex];
      } else {
        // use the emulator
        this.logger.info('Creating a Pub/Sub Connection using the emulator');
        this.logger.info(
          `Creating a Pub/Sub Connection. 
        'GUARDZ_PUB_SUB_API_ENDPOINT' isn't provided
        **************************************** USING THE EMULATOR ****************************************`,
        );
        this.pubSubClientsMap[subscriptionName] = new PubSub({
          projectId: 'local-project',
        });
      }
    }

    return this.pubSubClientsMap[subscriptionName];
  }

  private static isMetadataChanged(
    [currentMetadata]: GetSubscriptionMetadataResponse,
    updateMetadata: CreateSubscriptionOptions,
  ) {
    const {
      messageRetentionDuration: currentMessageRetentionDuration,
      retryPolicy: currentRetryPolicy,
      ...restCurrentMetadata
    } = currentMetadata;
    const {
      messageRetentionDuration: updateMessageRetentionDuration,
      retryPolicy: updateRetryPolicy,
      ...restUpdateMetadata
    } = updateMetadata;
    const isRestMetadataEqual = _isMatch(restCurrentMetadata, restUpdateMetadata);
    // Specific handle for `messageRetentionDuration` and `retryPolicy` since their nesting keys and values are difference
    const isMessageRetentionDurationEqual =
      updateMessageRetentionDuration?.toString() === currentMessageRetentionDuration?.seconds?.toString();
    const isRetryPolicyChanged =
      (updateRetryPolicy?.maximumBackoff?.nanos?.toString() || '0') !==
        currentRetryPolicy?.maximumBackoff?.nanos?.toString() ||
      updateRetryPolicy?.maximumBackoff?.seconds?.toString() !==
        currentRetryPolicy?.maximumBackoff?.seconds?.toString() ||
      (updateRetryPolicy?.minimumBackoff?.nanos?.toString() || '0') !==
        currentRetryPolicy?.minimumBackoff?.nanos?.toString() ||
      updateRetryPolicy?.minimumBackoff?.seconds?.toString() !==
        currentRetryPolicy?.minimumBackoff?.seconds?.toString();

    return !isRestMetadataEqual || !isMessageRetentionDurationEqual || isRetryPolicyChanged;
  }
}
