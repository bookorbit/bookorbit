import { AuthSessionRepository } from './auth-session.repository';
import { AuthSessionService } from './auth-session.service';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import type { StringValue } from 'ms';

import { CommonModule } from '../../common/common.module';
import { ApiKeyModule } from '../api-key/api-key.module';
import { AppSettingsModule } from '../app-settings/app-settings.module';
import { AuditModule } from '../audit/audit.module';
import { EmailModule } from '../email/email.module';
import { UserModule } from '../user/user.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthenticatorService } from './authenticator.service';
import { JwtStrategy } from './jwt.strategy';
import { MagicLinkRepository } from './magic-link.repository';
import { MagicLinkService } from './magic-link.service';
import { BackchannelLogoutService } from './oidc/backchannel-logout.service';
import { OidcClaimExtractorService } from './oidc/oidc-claim-extractor.service';
import { OidcCleanupJob } from './oidc/oidc-cleanup.job';
import { OidcCleanupService } from './oidc/oidc-cleanup.service';
import { OidcDiscoveryService } from './oidc/oidc-discovery.service';
import { OidcGroupMappingService } from './oidc/oidc-group-mapping.service';
import { OidcService } from './oidc/oidc.service';
import { OidcSessionRepository } from './oidc/oidc-session.repository';
import { OidcStateService } from './oidc/oidc-state.service';
import { OidcTokenClientService } from './oidc/oidc-token-client.service';
import { OidcTokenValidatorService } from './oidc/oidc-token-validator.service';

/**
 * Global so any gateway can authenticate a socket. Importing it instead would close an import cycle
 * through EmailModule and NotificationModule.
 */
@Global()
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('auth.jwtSecret'),
        signOptions: { expiresIn: config.getOrThrow<StringValue | number>('auth.jwtExpiresIn'), algorithm: 'HS256' },
      }),
    }),
    UserModule,
    CommonModule,
    AppSettingsModule,
    AuditModule,
    EmailModule,
    ApiKeyModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthenticatorService,
    AuthSessionRepository,
    AuthSessionService,
    JwtStrategy,
    MagicLinkRepository,
    MagicLinkService,
    OidcService,
    OidcStateService,
    OidcDiscoveryService,
    OidcTokenClientService,
    OidcTokenValidatorService,
    OidcClaimExtractorService,
    OidcSessionRepository,
    OidcGroupMappingService,
    BackchannelLogoutService,
    OidcCleanupService,
    OidcCleanupJob,
  ],
  exports: [AuthService, AuthenticatorService],
})
export class AuthModule {}
