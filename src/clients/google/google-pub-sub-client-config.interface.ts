type GooglePubSubClientConfigInterface = {
  MAX_NUMBER_OF_DELIVERY_ATTEMPTS: number;
  PUB_SUB_RETENTION_ACK_DEADLINE: number;
  GCP_PROJECT_NUMBER?: number;
  SERVER_SERVICE_ACCOUNT_SECRET?: string;
  PUB_SUB_API_ENDPOINT?: string;
};

export const GOOGLE_PUB_SUB_CLIENT_CONFIG_KEY = 'GOOGLE_PUB_SUB_CLIENT_CONFIG_KEY';

export default GooglePubSubClientConfigInterface;
