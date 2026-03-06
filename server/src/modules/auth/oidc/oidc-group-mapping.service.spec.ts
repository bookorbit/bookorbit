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

  it('inserts role assignments for matched groups', async () => {
    db.query.oidcGroupMappings.findMany.mockResolvedValue([
      { oidcGroupClaim: 'admins', roleId: 10 },
      { oidcGroupClaim: 'editors', roleId: 20 },
    ]);

    await service.syncUserGroups(42, ['admins', 'editors']);

    expect(db.insert).toHaveBeenCalledTimes(2);
    expect(db.values).toHaveBeenCalledWith({ userId: 42, roleId: 10 });
    expect(db.values).toHaveBeenCalledWith({ userId: 42, roleId: 20 });
  });

  it('deduplicates roleIds when multiple group claims map to the same role', async () => {
    db.query.oidcGroupMappings.findMany.mockResolvedValue([
      { oidcGroupClaim: 'admins', roleId: 10 },
      { oidcGroupClaim: 'superadmins', roleId: 10 },
    ]);

    await service.syncUserGroups(42, ['admins', 'superadmins']);

    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it('does nothing when no mappings match the provided groups', async () => {
    db.query.oidcGroupMappings.findMany.mockResolvedValue([]);

    await service.syncUserGroups(42, ['unknown-group']);

    expect(db.insert).not.toHaveBeenCalled();
  });

  it('skips mappings with null roleId', async () => {
    db.query.oidcGroupMappings.findMany.mockResolvedValue([
      { oidcGroupClaim: 'admins', roleId: null },
      { oidcGroupClaim: 'editors', roleId: 5 },
    ]);

    await service.syncUserGroups(42, ['admins', 'editors']);

    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db.values).toHaveBeenCalledWith({ userId: 42, roleId: 5 });
  });

  it('uses onConflictDoNothing to avoid duplicate role assignments', async () => {
    db.query.oidcGroupMappings.findMany.mockResolvedValue([{ oidcGroupClaim: 'admins', roleId: 10 }]);

    await service.syncUserGroups(42, ['admins']);

    expect(db.onConflictDoNothing).toHaveBeenCalled();
  });
});
