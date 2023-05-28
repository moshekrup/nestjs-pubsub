import { registerAs } from '@nestjs/config';
import { IsOptional, IsString, IsNumber } from 'class-validator';
import validateEnvVariables from 'src/common/utils/config.util';

export class PubSubConfig {
  @IsString()
  GUARDZ_PUB_SUB_TOPIC_NAME: string;

  @IsString()
  GUARDZ_PUB_SUB_DEAD_LETTER_TOPIC_NAME: string;

  @IsString()
  GUARDZ_PUB_SUB_TOPIC_SUBSCRIPTION_PREFIX: string;

  @IsNumber()
  GUARDZ_PUB_SUB_RETENTION_DURATION_MESSAGE: number;

  @IsString()
  GUARDZ_PUB_SUB_RETENTION_ACKED_MESSAGE: string;

  @IsNumber()
  GUARDZ_PUB_SUB_RETENTION_ACK_DEADLINE: number;

  @IsNumber()
  GUARDZ_PUB_SUB_RETRY_POLICY_MINIMUM_BACKOFF_SECOND: number;

  @IsNumber()
  GUARDZ_PUB_SUB_RETRY_POLICY_MAXIMUM_BACKOFF_SECOND: number;

  @IsNumber()
  MAX_NUMBER_OF_DELIVERY_ATTEMPTS: number;

  @IsNumber()
  @IsOptional()
  GUARDZ_GCP_PROJECT_NUMBER?: number;

  @IsString()
  @IsOptional()
  GUARDZ_SERVER_SERVICE_ACCOUNT_SECRET: string;

  @IsString()
  @IsOptional()
  GUARDZ_PUB_SUB_API_ENDPOINT?: string;
}

export default registerAs('pub-sub-config', (): PubSubConfig => {
  return validateEnvVariables(PubSubConfig);
});
