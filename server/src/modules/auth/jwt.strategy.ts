import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { AuthService } from './auth.service';
import type { AuthenticationMethod } from '@bookorbit/types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([ExtractJwt.fromAuthHeaderAsBearerToken(), (req: any) => req?.cookies?.access_token ?? null]),
      secretOrKey: config.get<string>('auth.jwtSecret')!,
      algorithms: ['HS256'],
    });
  }

  async validate(payload: { sub: number; ver: number; amr?: AuthenticationMethod }) {
    const user = await this.authService.validateUser(payload.sub, payload.ver, payload.amr ?? 'legacy');
    if (!user) throw new UnauthorizedException();
    return user;
  }
}
