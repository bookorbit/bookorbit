import { copyFileSync, mkdtempSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type { BookFileTextRow, NewBookFileTextRow } from '../../db/schema';
import { EpubFormatWriter } from '../file-write/formats/epub/epub-format-writer';
import { extractBookText } from './text/foliate-book-text';
import { STORY_TEXT_EXTRACTION_VERSION } from './text/extraction-version';
import { StoryTextService, storyTextRefusal } from './story-text.service';
import type { StoryTextRepository } from './story-text.repository';
import type { StoryTextFile } from './story-text.types';

const FIXTURE = join(__dirname, 'test-fixtures', 'a-study-in-scarlet.epub');

class MemoryRepository {
  rows = new Map<number, BookFileTextRow>();
  files = new Map<number, StoryTextFile>();

  find(fileId: number) {
    return Promise.resolve(this.rows.get(fileId) ?? null);
  }

  findFile(fileId: number) {
    return Promise.resolve(this.files.get(fileId) ?? null);
  }

  save(row: NewBookFileTextRow) {
    const saved = { createdAt: new Date(), updatedAt: new Date(), ...row } as BookFileTextRow;
    this.rows.set(row.fileId, saved);
    return Promise.resolve(saved);
  }

  staleFileIds(version: number, after: number, limit: number) {
    const ids = [...this.rows.values()]
      .filter((row) => (row.extractionVersion < version || row.outcome === 'too-large') && row.fileId > after)
      .map((row) => row.fileId)
      .sort((a, b) => a - b);
    return Promise.resolve(ids.slice(0, limit));
  }
}

function fileFor(id: number, absolutePath: string, format = 'epub'): StoryTextFile {
  const info = statSync(absolutePath);
  return { id, bookId: 1, absolutePath, sizeBytes: info.size, mtime: new Date(Math.floor(info.mtimeMs)), format };
}

function setup(moves: { move: ReturnType<typeof vi.fn> } | null = null) {
  const repository = new MemoryRepository();
  const reader = vi.fn((path: string) => extractBookText(path));
  const service = new StoryTextService(repository as unknown as StoryTextRepository, moves, reader);
  return { repository, reader, service };
}

describe('StoryTextService', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'story-text-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('never reads the file on status: a new file reports checking once, then has its key', async () => {
    const repository = new MemoryRepository();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const reader = vi.fn(async (path: string) => {
      await gate;
      return extractBookText(path);
    });
    const service = new StoryTextService(repository as unknown as StoryTextRepository, null, reader);
    const file = fileFor(7, FIXTURE);
    repository.files.set(7, file);

    // Status answers while the key job is still reading, and asking again queues nothing more.
    expect(await service.cached(file)).toBeNull();
    expect(await service.cached(file)).toBeNull();
    expect(repository.rows.size).toBe(0);

    release();
    await service.idle();
    const row = await service.cached(file);
    expect(reader).toHaveBeenCalledTimes(1);
    expect(row).toMatchObject({ outcome: 'ready', language: 'en', extractionVersion: STORY_TEXT_EXTRACTION_VERSION });
    expect(row?.textKey).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.sections).toHaveLength(14);
    expect(row?.words).toBeGreaterThan(40000);
    expect(storyTextRefusal(row!, 400_000)).toBeNull();
    expect(storyTextRefusal(row!, 20_000)).toBe('too-long');
  });

  it("tells listeners the file's book once its text row is saved, and keeps going when one throws", async () => {
    const { repository, service } = setup();
    repository.files.set(7, { ...fileFor(7, FIXTURE), bookId: 42 });
    const failing = vi.fn(() => {
      throw new Error('listener broke');
    });
    const heard = vi.fn();
    service.onComputed(failing);
    const stop = service.onComputed(heard);

    expect(await service.cached(repository.files.get(7)!)).toBeNull();
    await service.idle();
    expect(heard).toHaveBeenCalledWith(42);
    expect(repository.rows.get(7)?.outcome).toBe('ready');

    stop();
    await service.compute(7);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it('keeps the key when metadata is written back into the file', async () => {
    const { repository, service } = setup();
    const path = join(dir, 'book.epub');
    copyFileSync(FIXTURE, path);
    repository.files.set(1, fileFor(1, path));
    const before = await service.compute(1);

    await new EpubFormatWriter().write(path, { title: 'A Different Title' }, { fieldMask: new Set(['title']), dryRun: false });
    const changed = fileFor(1, path);
    expect(changed.sizeBytes).not.toBe(before?.sizeBytes);
    repository.files.set(1, changed);

    expect(await service.cached(changed)).toBeNull();
    await service.idle();
    const after = await service.cached(changed);
    expect(after?.sizeBytes).toBe(changed.sizeBytes);
    expect(after?.textKey).toBe(before?.textKey);
  });

  it('gives each format of a book its own key, since sections differ', async () => {
    const { repository, service } = setup();
    repository.files.set(1, fileFor(1, FIXTURE));
    repository.files.set(2, fileFor(2, join(__dirname, 'test-fixtures', 'a-study-in-scarlet.azw3'), 'azw3'));
    const epub = await service.compute(1);
    const azw3 = await service.compute(2);
    expect(azw3?.sections).toHaveLength(14);
    expect(azw3?.textKey).not.toBe(epub?.textKey);
  });

  it('moves the guide to the new key when the extraction version changes the key', async () => {
    const moves = { move: vi.fn().mockResolvedValue(true) };
    const { repository, service } = setup(moves);
    const file = fileFor(3, FIXTURE);
    repository.files.set(3, file);
    await repository.save({
      fileId: 3,
      sizeBytes: file.sizeBytes,
      mtime: file.mtime,
      extractionVersion: STORY_TEXT_EXTRACTION_VERSION - 1,
      outcome: 'ready',
      textKey: 'a'.repeat(64),
      sections: [],
    });

    expect(await service.queueStale()).toBe(1);
    await service.idle();

    const row = repository.rows.get(3);
    expect(row?.extractionVersion).toBe(STORY_TEXT_EXTRACTION_VERSION);
    expect(row?.previousKey).toBe('a'.repeat(64));
    expect(moves.move).toHaveBeenCalledWith('a'.repeat(64), row?.textKey);
  });

  it('checks a file refused as too large again at the next start', async () => {
    const { repository, service } = setup();
    const file = fileFor(6, FIXTURE);
    repository.files.set(6, file);
    await repository.save({
      fileId: 6,
      sizeBytes: file.sizeBytes,
      mtime: file.mtime,
      extractionVersion: STORY_TEXT_EXTRACTION_VERSION,
      outcome: 'too-large',
      sections: [],
    });

    expect(await service.queueStale()).toBe(1);
    await service.idle();

    expect(repository.rows.get(6)).toMatchObject({ outcome: 'ready', extractionVersion: STORY_TEXT_EXTRACTION_VERSION });
    expect(await service.queueStale()).toBe(0);
  });

  it('records an unreadable file and one past the size limit', async () => {
    const { repository, service } = setup();
    const reader = vi.fn().mockRejectedValue(new Error('broken archive'));
    const failing = new StoryTextService(repository as unknown as StoryTextRepository, null, reader);
    repository.files.set(4, fileFor(4, FIXTURE));
    expect(await failing.compute(4)).toMatchObject({ outcome: 'unreadable', textKey: null });
    expect(storyTextRefusal(repository.rows.get(4)!, 400_000)).toBe('unreadable');

    const { BookTextError } = await import('./text/book-text.types');
    const tooLarge = new StoryTextService(
      repository as unknown as StoryTextRepository,
      null,
      vi.fn().mockRejectedValue(new BookTextError('too-large', 'file is too large')),
    );
    expect(await tooLarge.compute(4)).toMatchObject({ outcome: 'too-large' });
    expect(storyTextRefusal(repository.rows.get(4)!, 400_000)).toBe('too-large');
    expect(service).toBeDefined();
  });

  it('skips files that are not in a story format, and files that are gone', async () => {
    const { repository, reader, service } = setup();
    const pdf = { ...fileFor(5, FIXTURE), format: 'pdf' };
    repository.files.set(5, pdf);
    expect(await service.cached(pdf)).toBeNull();
    await service.idle();
    expect(await service.compute(5)).toBeNull();
    expect(await service.compute(99)).toBeNull();
    expect(reader).not.toHaveBeenCalled();
  });

  it('refuses a short book and one in another language', () => {
    const base = { outcome: 'ready', textKey: 'k', language: 'en', words: 4999 } as BookFileTextRow;
    expect(storyTextRefusal(base, 400_000)).toBe('too-short');
    expect(storyTextRefusal({ ...base, words: 9000, language: null }, 400_000)).toBe('language');
  });
});
