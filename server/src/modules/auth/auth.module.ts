import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { CommonModule } from '../../common/common.module';
import { AppSettingsModule } from '../app-settings/app-settings.module';
import { UserModule } from '../user/user.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { BackchannelLogoutService } from './oidc/backchannel-logout.service';
import { OidcClaimExtractorService } from './oidc/oidc-claim-extractor.service';
import { OidcDiscoveryService } from './oidc/oidc-discovery.service';
import { OidcGroupMappingService } from './oidc/oidc-group-mapping.service';
import { OidcService } from './oidc/oidc.service';
import { OidcSessionRepository } from './oidc/oidc-session.repository';
import { OidcStateService } from './oidc/oidc-state.service';
import { OidcTokenClientService } from './oidc/oidc-token-client.service';
import { OidcTokenValidatorService } from './oidc/oidc-token-validator.service';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('auth.jwtSecret'),
        signOptions: { expiresIn: config.get('auth.jwtExpiresIn') as any },
      }),
    }),
    UserModule,
    CommonModule,
    AppSettingsModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    OidcService,
    OidcStateService,
    OidcDiscoveryService,
    OidcTokenClientService,
    OidcTokenValidatorService,
    OidcClaimExtractorService,
    OidcSessionRepository,
    OidcGroupMappingService,
    BackchannelLogoutService,
  ],
  exports: [AuthService],
})
export class AuthModule {}
