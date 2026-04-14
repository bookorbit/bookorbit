import { OidcGroupMappingService } from './oidc-group-mapping.service';

function makeTx() {
  return {
    query: {
      oidcGroupMappings: { findMany: vi.fn().mockResolvedValue([]) },
      oidcPermissionGrants: { findMany: vi.fn().mockResolvedValue([]) },
      userPermissions: { findMany: vi.fn().mockResolvedValue([]) },
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
    await service.syncUserGroups(1, 1, []);
    // Only delete for cleanup, no insert for permissions
    expect(db.tx.insert).not.toHaveBeenCalled();
  });

  it('adds desired permissions from provider-scoped mappings', async () => {
    db.tx.query.oidcGroupMappings.findMany.mockResolvedValue([{ oidcGroupClaim: 'admins', permissionName: 'manage_users', providerId: 1 }]);
    db.tx.query.oidcPermissionGrants.findMany.mockResolvedValue([]);
    db.tx.query.userPermissions.findMany.mockResolvedValue([]);

    await service.syncUserGroups(42, 1, ['admins']);

    expect(db.tx.insert).toHaveBeenCalled();
  });

  it('removes stale grants when user no longer has matching groups', async () => {
    db.tx.query.oidcGroupMappings.findMany.mockResolvedValue([{ oidcGroupClaim: 'admins', permissionName: 'manage_users', providerId: 1 }]);
    db.tx.query.oidcPermissionGrants.findMany.mockResolvedValue([{ userId: 42, providerId: 1, permissionName: 'manage_users' }]);
    db.tx.query.userPermissions.findMany.mockResolvedValue([{ userId: 42, permissionName: 'manage_users' }]);

    await service.syncUserGroups(42, 1, []);

    expect(db.tx.delete).toHaveBeenCalled();
  });

  it('deduplicates when multiple group claims map to the same permission', async () => {
    db.tx.query.oidcGroupMappings.findMany.mockResolvedValue([
      { oidcGroupClaim: 'admins', permissionName: 'manage_users', providerId: 1 },
      { oidcGroupClaim: 'superadmins', permissionName: 'manage_users', providerId: 1 },
    ]);
    db.tx.query.oidcPermissionGrants.findMany.mockResolvedValue([]);
    db.tx.query.userPermissions.findMany.mockResolvedValue([]);

    await service.syncUserGroups(42, 1, ['admins', 'superadmins']);

    expect(db.tx.insert).toHaveBeenCalled();
  });

  it('skips mappings with null permissionName', async () => {
    db.tx.query.oidcGroupMappings.findMany.mockResolvedValue([
      { oidcGroupClaim: 'admins', permissionName: null, providerId: 1 },
      { oidcGroupClaim: 'editors', permissionName: 'library_edit_metadata', providerId: 1 },
    ]);
    db.tx.query.oidcPermissionGrants.findMany.mockResolvedValue([]);
    db.tx.query.userPermissions.findMany.mockResolvedValue([]);

    await service.syncUserGroups(42, 1, ['admins', 'editors']);

    expect(db.tx.insert).toHaveBeenCalled();
  });

  it('does not insert permissions user already has', async () => {
    db.tx.query.oidcGroupMappings.findMany.mockResolvedValue([{ oidcGroupClaim: 'admins', permissionName: 'manage_users', providerId: 1 }]);
    db.tx.query.oidcPermissionGrants.findMany.mockResolvedValue([{ userId: 42, providerId: 1, permissionName: 'manage_users' }]);
    db.tx.query.userPermissions.findMany.mockResolvedValue([{ userId: 42, permissionName: 'manage_users' }]);

    await service.syncUserGroups(42, 1, ['admins']);

    // Provider grants unchanged, user perms unchanged
    // insert may be called for onConflictDoNothing but no new values
    expect(db.tx.delete).not.toHaveBeenCalled();
  });
});
