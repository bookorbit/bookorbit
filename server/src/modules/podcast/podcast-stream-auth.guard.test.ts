import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { PodcastStreamAuthGuard, firstQueryValue } from './podcast-stream-auth.guard';

function makeUser(overrides: Partial<RequestUser> = {}): RequestUser {
  return {
    id: 7,
    username: 'listener',
    name: 'Listener',
    email: null,
    active: true,
    isSuperuser: false,
    isDefaultPassword: false,
    tokenVersion: 3,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [],
    contentFilters: EMPTY_CONTENT_FILTER_RULES,
    ...overrides,
  };
}

function makeContext(request: Record<string, unknown>) {
  return {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as never;
}

describe('firstQueryValue', () => {
  it('reads a single value', () => {
    expect(firstQueryValue({ ticket: 'abc' }, 'ticket')).toBe('abc');
  });

  it('reads the first of a repeated value', () => {
    expect(firstQueryValue({ ticket: ['abc', 'def'] }, 'ticket')).toBe('abc');
  });

  it('treats missing and empty values as absent', () => {
    expect(firstQueryValue({}, 'ticket')).toBeUndefined();
    expect(firstQueryValue({ ticket: '' }, 'ticket')).toBeUndefined();
    expect(firstQueryValue(undefined, 'ticket')).toBeUndefined();
  });
});

describe('PodcastStreamAuthGuard', () => {
  it('resolves the user from a ticket scoped to the requested episode', async () => {
    const user = makeUser();
    const tickets = { authorize: vi.fn().mockResolvedValue(user) };
    const guard = new PodcastStreamAuthGuard(tickets as never);
    const request: Record<string, unknown> = { query: { ticket: 'abc' }, params: { episodeId: '42' } };

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    expect(tickets.authorize).toHaveBeenCalledWith('abc', 42);
    expect(request.user).toBe(user);
  });

  it('rejects a ticket on a route without a usable episode id', async () => {
    const tickets = { authorize: vi.fn() };
    const guard = new PodcastStreamAuthGuard(tickets as never);

    await expect(guard.canActivate(makeContext({ query: { ticket: 'abc' }, params: { episodeId: 'nope' } }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(tickets.authorize).not.toHaveBeenCalled();
  });

  it('falls back to header auth when no ticket is present', async () => {
    const tickets = { authorize: vi.fn() };
    const guard = new PodcastStreamAuthGuard(tickets as never);
    const passport = vi.spyOn(Object.getPrototypeOf(Object.getPrototypeOf(guard)), 'canActivate').mockResolvedValue(true);

    await expect(guard.canActivate(makeContext({ query: {}, params: { episodeId: '42' } }))).resolves.toBe(true);
    expect(tickets.authorize).not.toHaveBeenCalled();
    passport.mockRestore();
  });

  it('keeps the default-password and missing-user denials of the global guard', () => {
    const guard = new PodcastStreamAuthGuard({ authorize: vi.fn() } as never);

    expect(() => guard.handleRequest(null, undefined as never)).toThrow(UnauthorizedException);
    expect(() => guard.handleRequest(null, makeUser({ isDefaultPassword: true }))).toThrow(ForbiddenException);
    const user = makeUser();
    expect(guard.handleRequest(null, user)).toBe(user);
  });
});
