import { OidcGroupMappingService } from './oidc-group-mapping.service';

function makeTx() {
  return {
    query: {
      oidcGroupMappings: { findMany: vi.fn() },
      userPermissions: { findMany: vi.fn() },
    },
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(undefined),
  };
}

function makeDb() {
  const tx = makeTx();
  return {
    tx,
    transaction: vi.fn().mockImplementation(async (cb: (tx: unknown) => Promise<void>) => cb(tx)),
  };
}

describe('OidcGroupMappingService', () => {
  let service: OidcGroupMappingService;
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => {
    db = makeDb();
    service = new OidcGroupMappingService(db as never);
  });

  it('does nothing when no system mappings exist', async () => {
    db.tx.query.oidcGroupMappings.findMany.mockResolvedValue([]);
    await service.syncUserGroups(1, []);
    expect(db.tx.insert).not.toHaveBeenCalled();
    expect(db.tx.delete).not.toHaveBeenCalled();
  });

  it('adds desired permissions and skips existing ones', async () => {
    db.tx.query.oidcGroupMappings.findMany.mockResolvedValue([{ oidcGroupClaim: 'admins', permissionName: 'manage_users' }]);
    db.tx.query.userPermissions.findMany.mockResolvedValue([]);

    await service.syncUserGroups(42, ['admins']);

    expect(db.tx.insert).toHaveBeenCalledTimes(1);
    expect(db.tx.values).toHaveBeenCalledWith([{ userId: 42, permissionName: 'manage_users' }]);
    expect(db.tx.delete).not.toHaveBeenCalled();
  });

  it('removes stale OIDC-managed permissions when user no longer has matching groups', async () => {
    db.tx.query.oidcGroupMappings.findMany.mockResolvedValue([{ oidcGroupClaim: 'admins', permissionName: 'manage_users' }]);
    db.tx.query.userPermissions.findMany.mockResolvedValue([{ userId: 42, permissionName: 'manage_users' }]);

    await service.syncUserGroups(42, []);

    expect(db.tx.insert).not.toHaveBeenCalled();
    expect(db.tx.delete).toHaveBeenCalledTimes(1);
  });

  it('does not remove permissions not in oidc_group_mappings (manually-granted)', async () => {
    db.tx.query.oidcGroupMappings.findMany.mockResolvedValue([{ oidcGroupClaim: 'admins', permissionName: 'manage_users' }]);
    db.tx.query.userPermissions.findMany.mockResolvedValue([
      { userId: 42, permissionName: 'manage_users' },
      { userId: 42, permissionName: 'library_edit_metadata' },
    ]);

    await service.syncUserGroups(42, []);

    // manage_users is OIDC-managed and should be removed; library_edit_metadata is not
    expect(db.tx.delete).toHaveBeenCalledTimes(1);
    expect(db.tx.insert).not.toHaveBeenCalled();
  });

  it('deduplicates when multiple group claims map to the same permission', async () => {
    db.tx.query.oidcGroupMappings.findMany.mockResolvedValue([
      { oidcGroupClaim: 'admins', permissionName: 'manage_users' },
      { oidcGroupClaim: 'superadmins', permissionName: 'manage_users' },
    ]);
    db.tx.query.userPermissions.findMany.mockResolvedValue([]);

    await service.syncUserGroups(42, ['admins', 'superadmins']);

    expect(db.tx.insert).toHaveBeenCalledTimes(1);
    expect(db.tx.values).toHaveBeenCalledWith([{ userId: 42, permissionName: 'manage_users' }]);
  });

  it('skips mappings with null permissionName', async () => {
    db.tx.query.oidcGroupMappings.findMany.mockResolvedValue([
      { oidcGroupClaim: 'admins', permissionName: null },
      { oidcGroupClaim: 'editors', permissionName: 'library_edit_metadata' },
    ]);
    db.tx.query.userPermissions.findMany.mockResolvedValue([]);

    await service.syncUserGroups(42, ['admins', 'editors']);

    expect(db.tx.insert).toHaveBeenCalledTimes(1);
    expect(db.tx.values).toHaveBeenCalledWith([{ userId: 42, permissionName: 'library_edit_metadata' }]);
  });

  it('does not insert permissions user already has', async () => {
    db.tx.query.oidcGroupMappings.findMany.mockResolvedValue([{ oidcGroupClaim: 'admins', permissionName: 'manage_users' }]);
    db.tx.query.userPermissions.findMany.mockResolvedValue([{ userId: 42, permissionName: 'manage_users' }]);

    await service.syncUserGroups(42, ['admins']);

    expect(db.tx.insert).not.toHaveBeenCalled();
    expect(db.tx.delete).not.toHaveBeenCalled();
  });
});
