import { describe, expect, it, vi } from 'vitest';

import { PodcastJobRepository } from './podcast-job.repository';

describe('PodcastJobRepository', () => {
  it('returns cancelled queued downloads to remote media state', async () => {
    const firstReturning = vi.fn().mockResolvedValue([
      { status: 'cancelled', type: 'download', episodeId: 11 },
      { status: 'processing', type: 'download', episodeId: 12 },
      { status: 'cancelled', type: 'refresh', episodeId: null },
    ]);
    const firstWhere = vi.fn().mockReturnValue({ returning: firstReturning });
    const firstSet = vi.fn().mockReturnValue({ where: firstWhere });
    const mediaWhere = vi.fn().mockResolvedValue(undefined);
    const mediaSet = vi.fn().mockReturnValue({ where: mediaWhere });
    const db = {
      update: vi.fn().mockReturnValueOnce({ set: firstSet }).mockReturnValueOnce({ set: mediaSet }),
    };
    const repository = new PodcastJobRepository(db as never);

    await expect(repository.cancelPodcastWork([3])).resolves.toBe(1);

    expect(db.update).toHaveBeenCalledTimes(2);
    expect(mediaSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'remote', lastError: null }));
  });

  it('does not issue an unbounded update for an empty podcast list', async () => {
    const db = { update: vi.fn() };
    const repository = new PodcastJobRepository(db as never);

    await expect(repository.cancelPodcastWork([])).resolves.toBe(0);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('does not query download batches without an authorized library scope', async () => {
    const db = { select: vi.fn() };
    const repository = new PodcastJobRepository(db as never);

    await expect(repository.listActiveDownloadBatchJobs(42, [])).resolves.toEqual([]);
    await expect(repository.findDownloadBatchJobs(42, [], ['0f31ea6f-03f0-4e3d-ae5c-1467ae7ec115'])).resolves.toEqual([]);

    expect(db.select).not.toHaveBeenCalled();
  });

  it('returns batch ids for queued downloads cancelled before a worker claims them', async () => {
    const returning = vi.fn().mockResolvedValue([
      { status: 'cancelled', batchId: '0f31ea6f-03f0-4e3d-ae5c-1467ae7ec115' },
      { status: 'processing', batchId: 'b4afdd4e-bc3d-42a1-a6eb-f4e8cb6dca0f' },
    ]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    const repository = new PodcastJobRepository({ update: vi.fn().mockReturnValue({ set }) } as never);

    await expect(repository.cancelEpisodeDownload(42)).resolves.toEqual({
      processing: 1,
      cancelledBatchIds: ['0f31ea6f-03f0-4e3d-ae5c-1467ae7ec115'],
    });
  });
});
