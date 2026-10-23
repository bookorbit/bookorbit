import { Test } from '@nestjs/testing';
import { DB } from '../../db/db.module';
import { createCapturingDb } from '../../common/test-utils/capture-sql-db';
import { KoboDownloadRepository } from './kobo-download.repository';

const HASH = 'a'.repeat(32);

async function makeRepository(db: unknown) {
  const module = await Test.createTestingModule({ providers: [KoboDownloadRepository, { provide: DB, useValue: db }] }).compile();
  return module.get(KoboDownloadRepository);
}

describe('KoboDownloadRepository', () => {
  it('adds intrinsic download identity without replacing original hashes or manual mappings', async () => {
    const { db, queries } = createCapturingDb();
    const repository = await makeRepository(db);
    await repository.registerDeliveredHash(22, HASH);
    expect(queries.map((query) => query.sql)).toEqual(['begin', "set local lock_timeout = '1s'", expect.stringContaining('insert into'), 'commit']);
    expect(queries[2]!.sql).toContain('insert into "book_file_hash_history"');
    expect(queries[2]!.params).toEqual(expect.arrayContaining([HASH, 'kobo_download', 22]));
    expect(queries[2]!.sql).toContain('on conflict (book_file_id, file_hash) do nothing');
    expect(queries[2]!.sql).toContain('update "libraries"');
    expect(queries[2]!.sql).toContain('koreader_hash_revision = koreader_hash_revision + 1');
    expect(queries[2]!.sql).not.toContain('koreader_book_hash_links');
  });

  it('uses a file-and-hash conflict key so repeated registration is idempotent and collisions remain representable', async () => {
    const { db, queries } = createCapturingDb();
    const repository = await makeRepository(db);
    await repository.registerDeliveredHash(22, HASH);
    await repository.registerDeliveredHash(22, HASH);
    await repository.registerDeliveredHash(33, HASH);
    const registrations = queries.filter((query) => query.sql.includes('insert into'));
    expect(registrations).toHaveLength(3);
    expect(registrations.map((query) => query.params)).toEqual([
      [HASH, 'kobo_download', 22],
      [HASH, 'kobo_download', 22],
      [HASH, 'kobo_download', 33],
    ]);
    expect(registrations.every((query) => query.sql.includes('do nothing'))).toBe(true);
  });

  it('propagates persistence failure for the registration service to queue', async () => {
    const failure = new Error('Database unavailable');
    const tx = { execute: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(failure) };
    const repository = await makeRepository({ transaction: vi.fn((callback) => callback(tx)) });
    await expect(repository.registerDeliveredHash(22, HASH)).rejects.toBe(failure);
  });

  it('honors the selected primary file inside its book without imposing a new role restriction', async () => {
    const { db, queries } = createCapturingDb();
    const repository = await makeRepository(db);
    await repository.findPrimaryFile(11, 22);
    expect(queries[0]!.sql).toContain('"bookFiles"."book_id" =');
    expect(queries[0]!.sql).toContain('"bookFiles"."id" =');
    expect(queries[0]!.sql).not.toContain('"bookFiles"."role" =');
    expect(queries[0]!.params).toEqual(expect.arrayContaining([11, 22]));
  });

  it('selects only book identity and primary-file identity', async () => {
    const { db, queries } = createCapturingDb();
    const repository = await makeRepository(db);
    await repository.findBook(11);
    expect(queries[0]!.sql).toContain('"id", "primary_file_id"');
    expect(queries[0]!.params).toContain(11);
  });

  it('bounds cache-source lookup and verifies book, role and original/historical source identity', async () => {
    const { db, queries } = createCapturingDb();
    const repository = await makeRepository(db);
    await expect(repository.findCachedSourceFileId(11, HASH)).resolves.toBeNull();
    const query = queries[0]!;
    expect(query.sql).toContain('select distinct');
    expect(query.sql).toContain('left join "book_file_hash_history"');
    expect(query.sql).toContain('"book_files"."book_id" =');
    expect(query.sql).toContain('"book_files"."role" =');
    expect(query.sql).toContain('"book_file_hash_history"."reason" <>');
    expect(query.sql).toContain('limit');
    expect(query.params).toEqual(expect.arrayContaining([11, HASH, 'content', 'kobo_download', 2]));
  });

  it.each([
    { name: 'unique source', matches: [{ id: 22 }], result: 22 },
    { name: 'deleted or stale source', matches: [], result: null },
    { name: 'ambiguous source', matches: [{ id: 22 }, { id: 33 }], result: null },
  ])('recovers only a $name', async ({ matches, result }) => {
    const chain = { from: vi.fn(), leftJoin: vi.fn(), where: vi.fn(), limit: vi.fn().mockResolvedValue(matches) };
    chain.from.mockReturnValue(chain);
    chain.leftJoin.mockReturnValue(chain);
    chain.where.mockReturnValue(chain);
    const repository = await makeRepository({ selectDistinct: vi.fn().mockReturnValue(chain) });
    await expect(repository.findCachedSourceFileId(11, HASH)).resolves.toBe(result);
    expect(chain.limit).toHaveBeenCalledWith(2);
  });
});
