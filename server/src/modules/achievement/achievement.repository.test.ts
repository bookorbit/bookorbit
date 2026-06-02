import { AchievementRepository } from './achievement.repository';

function flattenSql(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(flattenSql).join(' ');
  if (!value || typeof value !== 'object') return '';

  const record = value as { queryChunks?: unknown[]; value?: unknown };
  return [flattenSql(record.value), flattenSql(record.queryChunks)].join(' ');
}

describe('AchievementRepository', () => {
  it('checks completed series by series id', async () => {
    const db = { execute: vi.fn().mockResolvedValue({ rows: [{}] }) };
    const repo = new AchievementRepository(db as never);

    await expect(repo.hasCompletedSeries(7)).resolves.toBe(true);

    const sqlText = flattenSql(db.execute.mock.calls[0][0]);
    expect(sqlText).toContain('bm.series_id');
    expect(sqlText).not.toContain('bm.series_name');
  });

  it('checks completed series size by series id', async () => {
    const db = { execute: vi.fn().mockResolvedValue({ rows: [] }) };
    const repo = new AchievementRepository(db as never);

    await expect(repo.hasCompletedSeriesOfSize(7, 3)).resolves.toBe(false);

    const sqlText = flattenSql(db.execute.mock.calls[0][0]);
    expect(sqlText).toContain('bm.series_id');
    expect(sqlText).not.toContain('bm.series_name');
  });
});
