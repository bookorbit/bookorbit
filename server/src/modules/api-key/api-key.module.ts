import { Module } from '@nestjs/common';

import { CommonModule } from '../../common/common.module';
import { AppSettingsModule } from '../app-settings/app-settings.module';
import { UserModule } from '../user/user.module';
import { ApiKeyCleanupJob } from './api-key-cleanup.job';
import { ApiKeyFailureLimiter } from './api-key-failure-limiter';
import { ApiKeyAuthenticator } from './api-key.authenticator';
import { ApiKeyController } from './api-key.controller';
import { ApiKeyRepository } from './api-key.repository';
import { ApiKeyService } from './api-key.service';
import { UserApiKeyController } from './user-api-key.controller';

/**
 * Imported by `AuthModule`, whose `AuthenticatorService` turns a presented key into a request user.
 * `AuthService` comes from that module being global, not from an import, which would be a cycle.
 */
@Module({
  imports: [CommonModule, AppSettingsModule, UserModule],
  controllers: [ApiKeyController, UserApiKeyController],
  providers: [ApiKeyRepository, ApiKeyService, ApiKeyAuthenticator, ApiKeyFailureLimiter, ApiKeyCleanupJob],
  exports: [ApiKeyAuthenticator],
})
export class ApiKeyModule {}
