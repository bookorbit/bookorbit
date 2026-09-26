import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AuthenticationMethod, PodcastStreamTicket } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { AuthService } from '../auth/auth.service';

const PODCAST_STREAM_AUDIENCE = 'bookorbit-podcast-stream';
const PODCAST_STREAM_TTL_SECONDS = 24 * 60 * 60;

interface PodcastStreamClaims {
  sub: string | number;
  ver: number;
  amr?: AuthenticationMethod;
  episodeId: number;
  purpose: 'podcast-stream';
  exp?: number;
}

/**
 * AVPlayer and other native players cannot attach an auth header to an asset URL, and access
 * tokens expire mid-session. A ticket grants exactly one episode's audio for one listening
 * session; a token-version bump (logout, password change) revokes every outstanding ticket.
 */
@Injectable()
export class PodcastStreamTicketService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
  ) {}

  async issue(episodeId: number, user: RequestUser): Promise<PodcastStreamTicket> {
    const ticket = await this.jwtService.signAsync(
      {
        ver: user.tokenVersion,
        amr: user.authenticationMethod ?? 'legacy',
        episodeId,
        purpose: 'podcast-stream',
      },
      {
        subject: String(user.id),
        audience: PODCAST_STREAM_AUDIENCE,
        expiresIn: PODCAST_STREAM_TTL_SECONDS,
      },
    );
    return {
      ticket,
      expiresAt: new Date(Date.now() + PODCAST_STREAM_TTL_SECONDS * 1000).toISOString(),
    };
  }

  async authorize(ticket: string, expectedEpisodeId: number): Promise<RequestUser> {
    let claims: PodcastStreamClaims;
    try {
      claims = await this.jwtService.verifyAsync<PodcastStreamClaims>(ticket, { audience: PODCAST_STREAM_AUDIENCE });
    } catch {
      throw new UnauthorizedException('Invalid or expired podcast stream ticket');
    }

    const userId = Number(claims.sub);
    if (
      claims.purpose !== 'podcast-stream' ||
      !Number.isInteger(userId) ||
      userId <= 0 ||
      !Number.isInteger(claims.ver) ||
      claims.episodeId !== expectedEpisodeId
    ) {
      throw new UnauthorizedException('Invalid podcast stream ticket');
    }

    try {
      return await this.authService.validateUser(userId, claims.ver, claims.amr ?? 'legacy');
    } catch {
      throw new UnauthorizedException('Podcast stream ticket is no longer valid');
    }
  }
}
