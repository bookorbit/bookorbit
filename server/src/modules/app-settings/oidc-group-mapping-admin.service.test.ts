import { NotFoundException } from '@nestjs/common';

import { OidcGroupMappingAdminService } from './oidc-group-mapping-admin.service';

function makeDb() {
  return {
    query: {
      oidcGroupMappings: {
        findMany: vi.fn(),
      },
    },
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  };
}

describe('OidcGroupMappingAdminService', () => {
  let service: OidcGroupMappingAdminService;
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => {
    db = makeDb();
    service = new OidcGroupMappingAdminService(db as never);
  });

  describe('listMappings', () => {
    it('returns all mappings ordered by oidcGroupClaim', async () => {
      const rows = [{ id: 1, oidcGroupClaim: 'admins', permissionName: 'manage_users' }];
      db.query.oidcGroupMappings.findMany.mockResolvedValue(rows);
      await expect(service.listMappings()).resolves.toEqual(rows);
    });
  });

  describe('updateMapping', () => {
    it('updates permissionName and returns the updated row', async () => {
      const row = { id: 5, oidcGroupClaim: 'editors', permissionName: 'manage_users' };
      db.returning.mockResolvedValue([row]);
      const result = await service.updateMapping(5, 'manage_users');
      expect(db.update).toHaveBeenCalled();
      expect(db.set).toHaveBeenCalledWith({ permissionName: 'manage_users' });
      expect(result).toEqual(row);
    });

    it('throws NotFoundException when row does not exist', async () => {
      db.returning.mockResolvedValue([]);
      await expect(service.updateMapping(99, 'manage_users')).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteMapping', () => {
    it('deletes the row when found', async () => {
      const row = { id: 3, oidcGroupClaim: 'admins', permissionName: 'manage_users' };
      db.returning.mockResolvedValue([row]);
      await expect(service.deleteMapping(3)).resolves.toBeUndefined();
      expect(db.delete).toHaveBeenCalled();
    });

    it('throws NotFoundException when row does not exist', async () => {
      db.returning.mockResolvedValue([]);
      await expect(service.deleteMapping(99)).rejects.toThrow(NotFoundException);
    });
  });
});
