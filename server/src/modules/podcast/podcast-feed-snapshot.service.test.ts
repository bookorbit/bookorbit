import { mkdtemp, readdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { podcastFeedSnapshotDirPath, podcastFeedSnapshotPath } from '../../common/podcast-feed-snapshot-storage';
import { PodcastFeedSnapshotService } from './podcast-feed-snapshot.service';

const FEED = `<?xml version="1.0" encoding="utf-8"?><rss><channel><title>Orbit Radio</title></channel></rss>`;

describe('PodcastFeedSnapshotService', () => {
  let appDataPath: string;
  let service: PodcastFeedSnapshotService;

  beforeAll(async () => {
    appDataPath = await mkdtemp(join(tmpdir(), 'podcast-feed-snapshot-'));
    service = new PodcastFeedSnapshotService({ getOrThrow: () => appDataPath } as never);
  });

  afterAll(async () => {
    await rm(appDataPath, { recursive: true, force: true });
  });

  it('round-trips a compressed feed and leaves no temporary file behind', async () => {
    await expect(service.write(3, FEED)).resolves.toBeInstanceOf(Date);

    expect(await readdir(podcastFeedSnapshotDirPath(appDataPath))).toEqual(['3.xml.gz']);
    await expect(service.read(3)).resolves.toBe(FEED);
  });

  it('keeps only the latest copy when a later refresh stores a changed feed', async () => {
    const changed = FEED.replace('Orbit Radio', 'Orbit Radio Weekly');

    await service.write(4, FEED);
    await service.write(4, changed);

    await expect(service.read(4)).resolves.toBe(changed);
    expect((await readdir(podcastFeedSnapshotDirPath(appDataPath))).filter((name) => name.startsWith('4'))).toEqual(['4.xml.gz']);
  });

  it('reads nothing for a podcast with no stored copy and removes one idempotently', async () => {
    await expect(service.read(99)).resolves.toBeNull();

    await service.write(5, FEED);
    await service.remove(5);
    await service.remove(5);

    await expect(service.read(5)).resolves.toBeNull();
  });

  it('reports a failed write instead of throwing, so a refresh that already succeeded still lands', async () => {
    const blocked = await mkdtemp(join(tmpdir(), 'podcast-feed-snapshot-blocked-'));
    await writeFile(podcastFeedSnapshotDirPath(blocked), 'not a directory');
    const blockedService = new PodcastFeedSnapshotService({ getOrThrow: () => blocked } as never);

    await expect(blockedService.write(6, FEED)).resolves.toBeNull();

    await rm(blocked, { recursive: true, force: true });
  });

  it('surfaces a corrupt stored copy rather than silently reporting no snapshot', async () => {
    await writeFile(podcastFeedSnapshotPath(appDataPath, 7), 'not gzip');

    await expect(service.read(7)).rejects.toThrow();
  });
});
