import { OidcGroupMappingService } from './oidc-group-mapping.service';

function makeDb() {
  return {
    query: {
      oidcGroupMappings: {
        findMany: jest.fn(),
      },
    },
    insert: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    onConflictDoNothing: jest.fn().mockResolvedValue(undefined),
  };
}

describe('OidcGroupMappingService', () => {
  let service: OidcGroupMappingService;
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => {
    db = makeDb();
    service = new OidcGroupMappingService(db as never);
  });

  it('does nothing when groups array is empty', async () => {
    await service.syncUserGroups(1, []);
    expect(db.query.oidcGroupMappings.findMany).not.toHaveBeenCalled();
  });

  it('inserts permission assignments for matched groups', async () => {
    db.query.oidcGroupMappings.findMany.mockResolvedValue([
      { oidcGroupClaim: 'admins', permissionName: 'manage_users' },
      { oidcGroupClaim: 'editors', permissionName: 'library_edit_metadata' },
    ]);

    await service.syncUserGroups(42, ['admins', 'editors']);

    expect(db.insert).toHaveBeenCalledTimes(2);
    expect(db.values).toHaveBeenCalledWith({ userId: 42, permissionName: 'manage_users' });
    expect(db.values).toHaveBeenCalledWith({ userId: 42, permissionName: 'library_edit_metadata' });
  });

  it('deduplicates permissionNames when multiple group claims map to the same permission', async () => {
    db.query.oidcGroupMappings.findMany.mockResolvedValue([
      { oidcGroupClaim: 'admins', permissionName: 'manage_users' },
      { oidcGroupClaim: 'superadmins', permissionName: 'manage_users' },
    ]);

    await service.syncUserGroups(42, ['admins', 'superadmins']);

    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it('does nothing when no mappings match the provided groups', async () => {
    db.query.oidcGroupMappings.findMany.mockResolvedValue([]);

    await service.syncUserGroups(42, ['unknown-group']);

    expect(db.insert).not.toHaveBeenCalled();
  });

  it('skips mappings with null permissionName', async () => {
    db.query.oidcGroupMappings.findMany.mockResolvedValue([
      { oidcGroupClaim: 'admins', permissionName: null },
      { oidcGroupClaim: 'editors', permissionName: 'library_edit_metadata' },
    ]);

    await service.syncUserGroups(42, ['admins', 'editors']);

    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db.values).toHaveBeenCalledWith({ userId: 42, permissionName: 'library_edit_metadata' });
  });

  it('uses onConflictDoNothing to avoid duplicate permission assignments', async () => {
    db.query.oidcGroupMappings.findMany.mockResolvedValue([{ oidcGroupClaim: 'admins', permissionName: 'manage_users' }]);

    await service.syncUserGroups(42, ['admins']);

    expect(db.onConflictDoNothing).toHaveBeenCalled();
  });
});
