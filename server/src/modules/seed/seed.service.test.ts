import { Logger } from '@nestjs/common';

import { APP_SETTING_KEYS } from '../../common/constants/app-settings.constants';
import * as schema from '../../db/schema';
import { SeedService } from './seed.service';

function makeDb(options?: { appSettingsInsertResult?: { rowCount?: number }; emailInsertResult?: { rowCount?: number } }) {
  const txInsertBuilder = {
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockResolvedValue(options?.appSettingsInsertResult ?? { rowCount: 14 }),
  };
  const emailInsertBuilder = {
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockResolvedValue(options?.emailInsertResult ?? { rowCount: 1 }),
  };
  const tx = {
    insert: vi.fn().mockReturnValue(txInsertBuilder),
  };

  return {
    transaction: vi.fn(async (cb: (trx: typeof tx) => Promise<number>) => cb(tx)),
    query: {
      emailTemplates: {
        findFirst: vi.fn(),
      },
    },
    insert: vi.fn().mockReturnValue(emailInsertBuilder),
    __txInsertBuilder: txInsertBuilder,
    __emailInsertBuilder: emailInsertBuilder,
    __tx: tx,
  };
}

describe('SeedService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('seeds all default app settings in a single transactional insert', async () => {
    const db = makeDb();
    db.query.emailTemplates.findFirst.mockResolvedValue({ id: 1, isSystem: true });
    const service = new SeedService(db as never);

    await service.onApplicationBootstrap();

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.__tx.insert).toHaveBeenCalledWith(schema.appSettings);
    expect(db.__txInsertBuilder.onConflictDoNothing).toHaveBeenCalledWith({ target: schema.appSettings.key });

    const insertedRows = db.__txInsertBuilder.values.mock.calls[0][0] as Array<{ key: string; value: string }>;
    expect(insertedRows.length).toBeGreaterThanOrEqual(14);
    expect(insertedRows).toContainEqual({ key: APP_SETTING_KEYS.ALLOW_REGISTRATION, value: 'false' });
    expect(insertedRows).toContainEqual({ key: APP_SETTING_KEYS.OPDS_ENABLED, value: 'true' });

    const oidcRow = insertedRows.find((row) => row.key === APP_SETTING_KEYS.OIDC_CONFIG);
    expect(oidcRow).toBeDefined();
    const oidc = JSON.parse(oidcRow!.value) as { providerName?: string };
    expect(oidc.providerName).toBe('');
  });

  it('inserts a system email template when none exists and ignores conflicts', async () => {
    const db = makeDb();
    db.query.emailTemplates.findFirst.mockResolvedValue(undefined);
    const service = new SeedService(db as never);

    await service.onApplicationBootstrap();

    expect(db.insert).toHaveBeenCalledWith(schema.emailTemplates);
    expect(db.__emailInsertBuilder.onConflictDoNothing).toHaveBeenCalledWith();

    const payload = db.__emailInsertBuilder.values.mock.calls[0][0] as {
      name: string;
      subject: string;
      bodyText: string;
      isSystem: boolean;
      isDefault: boolean;
      userId: number | null;
    };
    expect(payload.name).toBe('Default');
    expect(payload.subject).toContain('{{title}}');
    expect(payload.bodyText).toContain('{{senderName}}');
    expect(payload.isSystem).toBe(true);
    expect(payload.isDefault).toBe(true);
    expect(payload.userId).toBeNull();
  });

  it('does not insert system email template when one already exists', async () => {
    const db = makeDb();
    db.query.emailTemplates.findFirst.mockResolvedValue({ id: 8, isSystem: true });
    const service = new SeedService(db as never);

    await service.onApplicationBootstrap();

    expect(db.insert).not.toHaveBeenCalledWith(schema.emailTemplates);
  });

  it('logs and rethrows when seeding fails', async () => {
    const db = makeDb();
    const err = new Error('seed failed');
    db.__txInsertBuilder.onConflictDoNothing.mockRejectedValue(err);
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const service = new SeedService(db as never);

    await expect(service.onApplicationBootstrap()).rejects.toThrow('seed failed');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[seed.bootstrap_defaults] [fail]'));
  });
});
