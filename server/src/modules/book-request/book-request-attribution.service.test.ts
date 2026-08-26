import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Permission, withRequiredPermissions } from '@bookorbit/types';

import { BookRequestAttributionService } from './book-request-attribution.service';
import type { RequestUser } from '../../common/types/request-user';

function user(overrides: Partial<RequestUser> = {}): RequestUser {
  return {
    id: 1,
    username: 'reader',
    name: 'Reader',
    email: null,
    active: true,
    isSuperuser: false,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [Permission.BookRequestAccess],
    contentFilters: {},
    ...overrides,
  } as RequestUser;
}

/** An integration account as the assignment path builds one. */
function integration(overrides: Partial<RequestUser> = {}): RequestUser {
  return user({ id: 1, username: 'bookbot', name: 'Bookbot', permissions: withRequiredPermissions([Permission.ManageBookRequests]), ...overrides });
}

const subject = user({ id: 42, username: 'bob', name: 'Bob' });

function makeService(overrides: { findActingUser?: unknown } = {}) {
  const auth = { findActingUser: vi.fn().mockResolvedValue(subject), ...overrides };
  return { service: new BookRequestAttributionService(auth as never), auth };
}

/** The refusal code an integration reads, rather than the sentence a person reads. */
function errorCode(error: unknown): string | undefined {
  return ((error as { getResponse?: () => { errorCode?: string } }).getResponse?.() ?? {}).errorCode;
}

describe('BookRequestAttributionService.resolveSubject', () => {
  it('returns the caller untouched when no requester is named', async () => {
    const { service, auth } = makeService();
    const actor = user();

    await expect(service.resolveSubject(actor, undefined)).resolves.toBe(actor);
    await expect(service.resolveSubject(actor, null)).resolves.toBe(actor);
    // The path every ordinary request takes costs no lookup at all.
    expect(auth.findActingUser).not.toHaveBeenCalled();
  });

  it('treats the caller naming themselves as an ordinary request, with no permission needed', async () => {
    const { service, auth } = makeService();
    const actor = user({ id: 7 });

    await expect(service.resolveSubject(actor, 7)).resolves.toBe(actor);
    expect(auth.findActingUser).not.toHaveBeenCalled();
  });

  it('refuses a caller who cannot manage requests', async () => {
    const { service, auth } = makeService();

    const error = await service.resolveSubject(user(), 42).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(errorCode(error)).toBe('SUBMIT_ON_BEHALF_FORBIDDEN');
    // Refused before the lookup, so an ordinary user cannot probe which ids exist.
    expect(auth.findActingUser).not.toHaveBeenCalled();
  });

  it('refuses a caller holding only self-fulfilment, which is not a moderation permission', async () => {
    const { service } = makeService();
    const actor = user({ permissions: withRequiredPermissions([Permission.BookRequestSelfFulfill]) });

    await expect(service.resolveSubject(actor, 42)).rejects.toThrow(ForbiddenException);
  });

  it('allows a caller holding manage_book_requests', async () => {
    const { service, auth } = makeService();

    await expect(service.resolveSubject(integration(), 42)).resolves.toBe(subject);
    expect(auth.findActingUser).toHaveBeenCalledWith(42);
  });

  it('allows a superuser', async () => {
    const { service } = makeService();

    await expect(service.resolveSubject(user({ isSuperuser: true }), 42)).resolves.toBe(subject);
  });

  /**
   * The regression this whole file exists for. Falling back to the caller here reads as defensive
   * and is the exact mis-attribution the feature was built to end: an unknown id would file
   * silently under the integration, and nothing would say so.
   */
  it('refuses an unresolvable requester rather than filing under the caller', async () => {
    const { service } = makeService({ findActingUser: vi.fn().mockResolvedValue(null) });

    const error = await service.resolveSubject(integration(), 999).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotFoundException);
    expect(errorCode(error)).toBe('SUBMIT_ON_BEHALF_UNKNOWN_USER');
  });

  it('hands back the named user with their own permissions, never the caller with a new id', async () => {
    const namedUser = user({ id: 42, permissions: [Permission.BookRequestAccess, Permission.BookRequestAutoApprove] });
    const { service } = makeService({ findActingUser: vi.fn().mockResolvedValue(namedUser) });
    const actor = integration({ permissions: withRequiredPermissions([Permission.ManageBookRequests, Permission.BookRequestSelfFulfill]) });

    const resolved = await service.resolveSubject(actor, 42);
    expect(resolved).toBe(namedUser);
    expect(resolved.permissions).not.toContain(Permission.BookRequestSelfFulfill);
    expect(resolved.permissions).not.toContain(Permission.ManageBookRequests);
  });
});

describe('BookRequestAttributionService.createdByUserIdFor', () => {
  it('records nothing when the requester made their own request', () => {
    const { service } = makeService();
    const actor = user({ id: 7 });

    expect(service.createdByUserIdFor(actor, actor)).toBeNull();
  });

  it('records the caller when somebody else filed it', () => {
    const { service } = makeService();

    expect(service.createdByUserIdFor(integration({ id: 3 }), subject)).toBe(3);
  });
});
