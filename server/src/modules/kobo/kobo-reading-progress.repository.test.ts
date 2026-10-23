import { KoboReadingProgressRepository } from './kobo-reading-progress.repository';
import { createCapturingDb } from '../../common/test-utils/capture-sql-db';

describe('KoboReadingProgressRepository', () => {
  it.each([true, false])('atomically rejects stale writes with uncertain delivery=%s', async (uncertain) => {
    const { db, queries } = createCapturingDb();
    const saved = await new KoboReadingProgressRepository(db).save(
      { userId: 7, bookFileId: 44, percentage: 0, cfi: null, updatedAt: new Date('2026-01-02T00:00:00Z') },
      uncertain,
    );
    expect(saved).toBe(false);
    expect(queries).toHaveLength(1);
    expect(queries[0]!.sql).toContain('"reading_progress"."updated_at" <');
    expect(queries[0]!.sql.includes('"reading_progress"."percentage" <=')).toBe(uncertain);
    expect(queries[0]!.sql).toContain('on conflict ("book_file_id","user_id")');
  });

  it('looks up progress for the requested user and file only', async () => {
    const { db, queries } = createCapturingDb();
    await new KoboReadingProgressRepository(db).findForFile(7, 44);
    expect(queries[0]!.params).toEqual([7, 44, 1]);
  });

  it('queues restoration only for the originating user and device without changing acquisition state', async () => {
    const { db, queries } = createCapturingDb();
    await new KoboReadingProgressRepository(db).markDeviceBookUnsynced(7, 3, 44);
    expect(queries[0]!.params).toEqual([7, 3, 44]);
    expect(queries[0]!.sql).toContain('pending_delete = false');
    expect(queries[0]!.sql).toContain('removed_by_device = false');
    expect(queries[0]!.sql).not.toContain('is_new =');
  });
});
