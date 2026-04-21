import { APP_SETTING_KEYS } from '../../common/constants/app-settings.constants';
import { AppSettingsRepository } from './app-settings.repository';

function makeDb() {
  const chainable = {
    select: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    update: vi.fn(),
    set: vi.fn(),
    insert: vi.fn(),
    values: vi.fn(),
    onConflictDoUpdate: vi.fn(),
    returning: vi.fn(),
    query: {
      appSettings: {
        findFirst: vi.fn(),
      },
    },
  };

  chainable.select.mockReturnValue(chainable);
  chainable.from.mockReturnValue(chainable);
  chainable.where.mockReturnValue(chainable);
  chainable.orderBy.mockResolvedValue([]);
  chainable.update.mockReturnValue(chainable);
  chainable.set.mockReturnValue(chainable);
  chainable.insert.mockReturnValue(chainable);
  chainable.values.mockReturnValue(chainable);
  chainable.onConflictDoUpdate.mockResolvedValue(undefined);
  chainable.returning.mockResolvedValue([]);

  return chainable;
}

describe('AppSettingsRepository', () => {
  let repo: AppSettingsRepository;
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => {
    db = makeDb();
    repo = new AppSettingsRepository(db as never);
  });

  describe('listPublic', () => {
    it('returns rows excluding oidc_config via ne filter', async () => {
      const rows = [{ key: 'allow_registration', value: 'true' }];
      db.orderBy.mockResolvedValue(rows);
      const result = await repo.listPublic();
      expect(result).toEqual(rows);
      expect(db.where).toHaveBeenCalled();
    });
  });

  describe('findByKey', () => {
    it('returns the matching row', async () => {
      const row = { key: 'opds_enabled', value: 'true' };
      db.query.appSettings.findFirst.mockResolvedValue(row);
      expect(await repo.findByKey('opds_enabled')).toEqual(row);
    });

    it('returns undefined when not found', async () => {
      db.query.appSettings.findFirst.mockResolvedValue(undefined);
      expect(await repo.findByKey('missing')).toBeUndefined();
    });
  });

  describe('findMany', () => {
    it('returns rows for provided keys', async () => {
      const rows = [{ key: 'book_dock_auto_finalize_enabled', value: 'true' }];
      db.where.mockResolvedValue(rows);
      const result = await repo.findMany([APP_SETTING_KEYS.BOOK_DOCK_AUTO_FINALIZE_ENABLED]);
      expect(result).toEqual(rows);
    });

    it('returns empty array when no keys match', async () => {
      db.where.mockResolvedValue([]);
      expect(await repo.findMany(['nonexistent'])).toEqual([]);
    });
  });

  describe('updateByKey', () => {
    it('returns updated setting when key exists', async () => {
      const setting = { key: 'allow_registration', value: 'false' };
      db.returning.mockResolvedValue([setting]);
      expect(await repo.updateByKey('allow_registration', 'false')).toEqual(setting);
    });

    it('returns null when key does not exist', async () => {
      db.returning.mockResolvedValue([]);
      expect(await repo.updateByKey('nonexistent', 'value')).toBeNull();
    });
  });

  describe('upsert', () => {
    it('calls insert with onConflictDoUpdate', async () => {
      await repo.upsert('some_key', 'some_value');
      expect(db.insert).toHaveBeenCalled();
      expect(db.onConflictDoUpdate).toHaveBeenCalled();
    });

    it('resolves without error', async () => {
      await expect(repo.upsert('key', 'value')).resolves.toBeUndefined();
    });
  });
});
