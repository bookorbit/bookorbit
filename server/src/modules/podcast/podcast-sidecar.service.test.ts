import { mkdtemp, readFile, readdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SelfWriteRegistry } from '../../common/services/self-write-registry.service';
import { PodcastSidecarService } from './podcast-sidecar.service';

describe('PodcastSidecarService', () => {
  let folder: string;
  let rows: Array<Record<string, unknown>>;
  let selfWrites: SelfWriteRegistry;

  function buildService() {
    const repo = {
      listLocalEpisodesForSidecar: vi.fn((_podcastId: number, afterEpisodeId: number) => Promise.resolve(afterEpisodeId === 0 ? rows : [])),
    };
    selfWrites = new SelfWriteRegistry();
    return { service: new PodcastSidecarService(repo as never, selfWrites), repo };
  }

  function episode(overrides: Record<string, unknown> = {}) {
    return {
      episodeId: 1,
      title: 'Dawn Chorus',
      description: null,
      publishedAt: new Date('2026-03-04T00:00:00.000Z'),
      season: null,
      episode: null,
      durationSeconds: 610,
      localPath: join(folder, 'ep1.mp3'),
      ...overrides,
    };
  }

  async function readSidecar(): Promise<Record<string, unknown>> {
    return JSON.parse(await readFile(join(folder, 'metadata.json'), 'utf8')) as Record<string, unknown>;
  }

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'podcast-sidecar-'));
    rows = [episode()];
  });

  it('writes the show fields and one entry per episode', async () => {
    const { service } = buildService();

    await expect(service.writeShowSidecar(21, folder, { title: 'Field Notes', author: 'Ada', description: 'Sounds' })).resolves.toBe(true);

    expect(await readSidecar()).toEqual({
      title: 'Field Notes',
      author: 'Ada',
      description: 'Sounds',
      episodes: [{ path: 'ep1.mp3', title: 'Dawn Chorus', publishedAt: '2026-03-04T00:00:00.000Z', durationSeconds: 610 }],
    });
  });

  it('keys episodes by their path inside the show folder, so subfolders survive', async () => {
    rows = [episode({ episodeId: 2, localPath: join(folder, 'Season 01', 'ep2.mp3') })];
    const { service } = buildService();

    await service.writeShowSidecar(21, folder, { title: 'Field Notes', author: null, description: null });

    expect((await readSidecar()).episodes).toEqual([
      { path: 'Season 01/ep2.mp3', title: 'Dawn Chorus', publishedAt: '2026-03-04T00:00:00.000Z', durationSeconds: 610 },
    ]);
  });

  it('preserves keys the folder already carried that BookOrbit does not own', async () => {
    await writeFile(join(folder, 'metadata.json'), JSON.stringify({ title: 'Old', asin: 'B01', tags: ['nature'] }), 'utf8');
    const { service } = buildService();

    await service.writeShowSidecar(21, folder, { title: 'Field Notes', author: null, description: null });

    const written = await readSidecar();
    expect(written.asin).toBe('B01');
    expect(written.tags).toEqual(['nature']);
    expect(written.title).toBe('Field Notes');
  });

  it('replaces an unparseable sidecar rather than failing the import', async () => {
    await writeFile(join(folder, 'metadata.json'), '{ not json', 'utf8');
    const { service } = buildService();

    await expect(service.writeShowSidecar(21, folder, { title: 'Field Notes', author: null, description: null })).resolves.toBe(true);
    expect((await readSidecar()).title).toBe('Field Notes');
  });

  it('drops an episode whose file escaped the show folder', async () => {
    rows = [episode({ localPath: join(folder, '..', 'elsewhere.mp3') })];
    const { service } = buildService();

    await service.writeShowSidecar(21, folder, { title: 'Field Notes', author: null, description: null });

    expect((await readSidecar()).episodes).toEqual([]);
  });

  it('reports failure and leaves no temp file when the folder is gone', async () => {
    const { service } = buildService();

    await expect(service.writeShowSidecar(21, join(folder, 'missing'), { title: 'Field Notes', author: null, description: null })).resolves.toBe(
      false,
    );
    expect(await readdir(folder)).toEqual([]);
  });

  it('suppresses the watcher while writing, and stops suppressing afterwards', async () => {
    const { service } = buildService();
    const target = join(folder, 'metadata.json');
    const suppressedDuringWrite: boolean[] = [];
    const trackSpy = vi.spyOn(selfWrites, 'track');

    await service.writeShowSidecar(21, folder, { title: 'Field Notes', author: null, description: null });
    suppressedDuringWrite.push(selfWrites.isSuppressed(target));

    expect(trackSpy).toHaveBeenCalledWith([target], expect.any(Function));
    expect(suppressedDuringWrite).toEqual([false]);
  });
});
