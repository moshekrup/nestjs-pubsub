import { applyDecorators, SetMetadata } from '@nestjs/common';

export const SUBSCRIPTION_TO_HANDLER = 'SUBSCRIPTION_TO_DECORATOR';

export type SubscribeOptions = {
  subscriptionName: string;
  eventTypes?: string[];
};

const SubscribeTo = (subscribeToOptions: SubscribeOptions) =>
  applyDecorators(SetMetadata(SUBSCRIPTION_TO_HANDLER, subscribeToOptions));

export default SubscribeTo;
