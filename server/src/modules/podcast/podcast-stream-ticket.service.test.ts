import { UnauthorizedException } from '@nestjs/common';
import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { PodcastStreamTicketService } from './podcast-stream-ticket.service';

function makeUser(): RequestUser {
  return {
    id: 7,
    username: 'listener',
    name: 'Listener',
    email: null,
    active: true,
    isSuperuser: false,
    isDefaultPassword: false,
    tokenVersion: 3,
    authenticationMethod: 'password',
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [],
    contentFilters: EMPTY_CONTENT_FILTER_RULES,
  };
}

function makeService() {
  const user = makeUser();
  const jwt = {
    signAsync: vi.fn().mockResolvedValue('stream-ticket'),
    verifyAsync: vi.fn().mockResolvedValue({
      sub: String(user.id),
      ver: user.tokenVersion,
      amr: user.authenticationMethod,
      episodeId: 42,
      purpose: 'podcast-stream',
    }),
  };
  const auth = { validateUser: vi.fn().mockResolvedValue(user) };
  const service = new PodcastStreamTicketService(jwt as never, auth as never);
  return { service, jwt, auth, user };
}

describe('PodcastStreamTicketService', () => {
  it('issues an episode-scoped ticket with a 24 hour expiry', async () => {
    const { service, jwt, user } = makeService();
    const before = Date.now();
    const response = await service.issue(42, user);

    expect(response.ticket).toBe('stream-ticket');
    const expiresIn = new Date(response.expiresAt).getTime() - before;
    expect(expiresIn).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(expiresIn).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 1000);
    expect(jwt.signAsync).toHaveBeenCalledWith(
      { ver: 3, amr: 'password', episodeId: 42, purpose: 'podcast-stream' },
      expect.objectContaining({ subject: '7', audience: 'bookorbit-podcast-stream', expiresIn: 24 * 60 * 60 }),
    );
  });

  it('authorizes a ticket for its own episode', async () => {
    const { service, auth, user } = makeService();
    await expect(service.authorize('stream-ticket', 42)).resolves.toBe(user);
    expect(auth.validateUser).toHaveBeenCalledWith(7, 3, 'password');
  });

  it('rejects a ticket issued for a different episode', async () => {
    const { service } = makeService();
    await expect(service.authorize('stream-ticket', 43)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a ticket signed for another purpose', async () => {
    const { service, jwt } = makeService();
    jwt.verifyAsync.mockResolvedValue({ sub: '7', ver: 3, episodeId: 42, purpose: 'watch-download' });
    await expect(service.authorize('stream-ticket', 42)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a ticket whose signature or expiry no longer verifies', async () => {
    const { service, jwt } = makeService();
    jwt.verifyAsync.mockRejectedValue(new Error('jwt expired'));
    await expect(service.authorize('stream-ticket', 42)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a ticket after a token-version bump revokes it', async () => {
    const { service, auth } = makeService();
    auth.validateUser.mockRejectedValue(new UnauthorizedException());
    await expect(service.authorize('stream-ticket', 42)).rejects.toThrow('Podcast stream ticket is no longer valid');
  });

  it('verifies against the podcast stream audience', async () => {
    const { service, jwt } = makeService();
    await service.authorize('stream-ticket', 42);
    expect(jwt.verifyAsync).toHaveBeenCalledWith('stream-ticket', { audience: 'bookorbit-podcast-stream' });
  });
});
