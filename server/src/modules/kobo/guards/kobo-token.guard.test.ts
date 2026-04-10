import { UnauthorizedException } from '@nestjs/common';

import { Permission } from '@projectx/types';

import { KoboTokenGuard } from './kobo-token.guard';

function makeContext(request: Record<string, unknown>) {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as never;
}

function makeDb() {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockReturnValue({ where });
  const update = vi.fn().mockReturnValue({ set });

  return {
    query: {
      koboDevices: {
        findFirst: vi.fn(),
      },
    },
    update,
    set,
    where,
  };
}

describe('KoboTokenGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects requests without a device token param', async () => {
    const db = makeDb();
    const guard = new KoboTokenGuard(db as never, { findByIdWithPermissions: vi.fn() } as never, { userHas: vi.fn() } as never);

    await expect(guard.canActivate(makeContext({ params: {} }))).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(makeContext({ params: {} }))).rejects.toThrow('Missing device token');
  });

  it('rejects unknown tokens and disabled users', async () => {
    const db = makeDb();
    const userService = { findByIdWithPermissions: vi.fn() };
    const permissionService = { userHas: vi.fn() };
    const guard = new KoboTokenGuard(db as never, userService as never, permissionService as never);
    const request = { params: { deviceToken: 'tok-1' } };

    db.query.koboDevices.findFirst.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ id: 9, token: 'tok-1', userId: 7 });
    userService.findByIdWithPermissions.mockResolvedValueOnce({ id: 7, active: false });

    await expect(guard.canActivate(makeContext(request))).rejects.toThrow('Invalid device token');
    await expect(guard.canActivate(makeContext(request))).rejects.toThrow('Account not found or disabled');
  });

  it('rejects users whose Kobo sync permission has been revoked', async () => {
    const db = makeDb();
    const userService = { findByIdWithPermissions: vi.fn().mockResolvedValue({ id: 7, active: true }) };
    const permissionService = { userHas: vi.fn().mockReturnValue(false) };
    const guard = new KoboTokenGuard(db as never, userService as never, permissionService as never);

    db.query.koboDevices.findFirst.mockResolvedValue({ id: 9, token: 'tok-2', userId: 7 });

    await expect(guard.canActivate(makeContext({ params: { deviceToken: 'tok-2' } }))).rejects.toThrow('Kobo sync permission revoked');
    expect(permissionService.userHas).toHaveBeenCalledWith({ id: 7, active: true }, Permission.KoboSync);
  });

  it('attaches user and device context for valid tokens', async () => {
    const db = makeDb();
    const user = { id: 7, active: true, permissions: [Permission.KoboSync] };
    const userService = { findByIdWithPermissions: vi.fn().mockResolvedValue(user) };
    const permissionService = { userHas: vi.fn().mockReturnValue(true) };
    const guard = new KoboTokenGuard(db as never, userService as never, permissionService as never);

    db.query.koboDevices.findFirst.mockResolvedValue({ id: 13, token: 'tok-13', userId: 7 });

    const request = { params: { deviceToken: 'tok-13' } } as Record<string, unknown>;
    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);

    expect(request.user).toBe(user);
    expect(request.koboDevice).toEqual({ deviceId: 13, deviceToken: 'tok-13', userId: 7 });
    expect(db.update).toHaveBeenCalled();
    expect(db.where).toHaveBeenCalled();
  });

  it('does not fail auth when async last-seen update errors', async () => {
    const db = makeDb();
    db.where.mockRejectedValueOnce(new Error('update failed'));
    const userService = { findByIdWithPermissions: vi.fn().mockResolvedValue({ id: 4, active: true }) };
    const permissionService = { userHas: vi.fn().mockReturnValue(true) };
    const guard = new KoboTokenGuard(db as never, userService as never, permissionService as never);

    db.query.koboDevices.findFirst.mockResolvedValue({ id: 2, token: 'tok', userId: 4 });

    await expect(guard.canActivate(makeContext({ params: { deviceToken: 'tok' } }))).resolves.toBe(true);
  });
});
