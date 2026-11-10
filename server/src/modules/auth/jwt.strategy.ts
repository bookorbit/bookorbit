import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { type AccessTokenPayload, AuthenticatorService } from './authenticator.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly authenticator: AuthenticatorService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([ExtractJwt.fromAuthHeaderAsBearerToken(), (req: any) => req?.cookies?.access_token ?? null]),
      secretOrKey: config.get<string>('auth.jwtSecret')!,
      algorithms: ['HS256'],
    });
  }

  validate(payload: AccessTokenPayload) {
    return this.authenticator.authenticatePayload(payload);
  }
}
