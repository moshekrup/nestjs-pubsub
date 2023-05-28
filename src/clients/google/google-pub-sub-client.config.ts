import { registerAs } from '@nestjs/config';
import { Expose } from 'class-transformer';
import { IsOptional, IsString, IsNumber } from 'class-validator';
import validateEnvVariables from 'src/common/utils/config.util';
import GooglePubSubClientConfigInterface, {
  GOOGLE_PUB_SUB_CLIENT_CONFIG_KEY,
} from './google-pub-sub-client-config.interface';

export class GooglePubSubClientConfig implements GooglePubSubClientConfigInterface {
  @IsNumber()
  @Expose({ name: 'GUARDZ_PUB_SUB_RETENTION_ACK_DEADLINE' })
  PUB_SUB_RETENTION_ACK_DEADLINE: number;

  @IsNumber()
  MAX_NUMBER_OF_DELIVERY_ATTEMPTS: number;

  @IsNumber()
  @IsOptional()
  @Expose({ name: 'GUARDZ_GCP_PROJECT_NUMBER' })
  GCP_PROJECT_NUMBER?: number;

  @IsString()
  @IsOptional()
  @Expose({ name: 'GUARDZ_SERVER_SERVICE_ACCOUNT_SECRET' })
  SERVER_SERVICE_ACCOUNT_SECRET: string;

  @IsString()
  @IsOptional()
  @Expose({ name: 'GUARDZ_PUB_SUB_API_ENDPOINT' })
  PUB_SUB_API_ENDPOINT?: string;
}

export default registerAs(GOOGLE_PUB_SUB_CLIENT_CONFIG_KEY, (): GooglePubSubClientConfig => {
  return validateEnvVariables(GooglePubSubClientConfig);
});
