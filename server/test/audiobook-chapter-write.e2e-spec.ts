import { execFile as execFileCallback } from 'child_process';
import { randomUUID } from 'crypto';
import { mkdir, stat, writeFile } from 'fs/promises';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { promisify } from 'util';

import { eq } from 'drizzle-orm';
import { BOOK_CHAPTERS_ERROR_CODES, type BookChaptersState, type WriteBookChaptersResult } from '@bookorbit/types';

import { FileLockService, bookOperationLockKey } from '../src/common/services/file-lock.service';
import { computeAudiobookManifestRevision, orderAudiobookTracks } from '../src/common/utils/audiobook-chapters.utils';
import type { AudiobookManifest } from '@bookorbit/types';
import * as schema from '../src/db/schema';
import { MetadataService } from '../src/modules/metadata/metadata.service';
import { AudiobookChaptersService } from '../src/modules/audiobook-chapters/audiobook-chapters.service';
import { ChapterJobService } from '../src/modules/chapter-editor/chapter-job.service';
import { type BookChapterJobState } from '@bookorbit/types';
import { mergeAudioChapters } from '../src/modules/metadata/extractors/audio-chapter-merge';
import {
  authHeader,
  closeAuthorizationMatrixE2EContext,
  createAuthorizationMatrixE2EContext,
  createLibraryWithFolder,
  type AuthorizationMatrixE2EContext,
  type CreatedLibrary,
} from './e2e/authorization-matrix/authorization-matrix-harness';

const execFile = promisify(execFileCallback);
const requireInstaller = createRequire(__filename);
const FFMPEG = (requireInstaller('@ffmpeg-installer/ffmpeg') as { path: string }).path;
const FFPROBE = (requireInstaller('@ffprobe-installer/ffprobe') as { path: string }).path;

interface ProbedChapter {
  title: string;
  startMs: number;
  endMs: number;
}

async function probe(absolutePath: string): Promise<{ durationMs: number; chapters: ProbedChapter[]; dataStreams: number }> {
  const { stdout } = await execFile(FFPROBE, [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_chapters',
    '-show_streams',
    absolutePath,
  ]);
  const data = JSON.parse(stdout) as {
    format: { duration: string };
    chapters: { start_time: string; end_time: string; tags?: { title?: string } }[];
    streams: { codec_type: string }[];
  };
  return {
    durationMs: Math.round(Number(data.format.duration) * 1000),
    chapters: data.chapters.map((chapter) => ({
      title: chapter.tags?.title ?? '',
      startMs: Math.round(Number(chapter.start_time) * 1000),
      endMs: Math.round(Number(chapter.end_time) * 1000),
    })),
    dataStreams: data.streams.filter((stream) => stream.codec_type === 'data').length,
  };
}

/** A tone of the given length, in the format its extension names. */
async function makeAudio(absolutePath: string, seconds: number, chapters: { title: string; startMs: number; endMs: number }[] = []): Promise<void> {
  await mkdir(dirname(absolutePath), { recursive: true });
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=22050:duration=${seconds}`];
  if (chapters.length > 0) {
    const metadataPath = `${absolutePath}.ffmeta`;
    const lines = [
      ';FFMETADATA1',
      ...chapters.flatMap((chapter) => [
        '[CHAPTER]',
        'TIMEBASE=1/1000',
        `START=${chapter.startMs}`,
        `END=${chapter.endMs}`,
        `title=${chapter.title}`,
      ]),
    ];
    await writeFile(metadataPath, `${lines.join('\n')}\n`);
    args.push('-f', 'ffmetadata', '-i', metadataPath, '-map', '0', '-map_chapters', '1');
  }
  args.push('-ac', '1', ...(absolutePath.endsWith('.mp3') ? ['-c:a', 'libmp3lame'] : ['-c:a', 'aac']), absolutePath);
  await execFile(FFMPEG, args);
}

// Writes real files with real ffmpeg: the chapters a book is saved with land in each audio file on
// that file's own clock, and reading the files back gives the same book.
describe('Writing audiobook chapters into the audio files (e2e)', { timeout: 120_000 }, () => {
  let ctx!: AuthorizationMatrixE2EContext;
  let library!: CreatedLibrary;

  async function getState(bookId: number): Promise<BookChaptersState> {
    const response = await ctx.app.inject({ method: 'GET', url: `/api/v1/books/${bookId}/chapters`, headers: authHeader(ctx.adminToken) });
    expect(response.statusCode).toBe(200);
    return response.json<BookChaptersState>();
  }

  async function save(bookId: number, chapters: { title: string; startMs: number }[]): Promise<BookChaptersState> {
    const response = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/books/${bookId}/chapters`,
      headers: authHeader(ctx.adminToken),
      payload: { chapters, baseRevision: (await getState(bookId)).revision },
    });
    expect(response.statusCode).toBe(200);
    return response.json<BookChaptersState>();
  }

  function write(bookId: number, baseRevision: string) {
    return ctx.app.inject({
      method: 'POST',
      url: `/api/v1/books/${bookId}/chapters/write`,
      headers: authHeader(ctx.adminToken),
      payload: { baseRevision },
    });
  }

  async function setWriteBack(enabled: boolean) {
    await ctx.db
      .update(schema.libraries)
      .set({ fileWriteEnabled: enabled, fileWriteAudioEnabled: true, fileWriteWriteCover: false, fileRenameEnabled: false })
      .where(eq(schema.libraries.id, library.libraryId));
  }

  beforeAll(async () => {
    // The app finds its tools on PATH unless told otherwise; point it at the same binaries the
    // fixtures are made with so the suite does not depend on what the machine has installed.
    process.env.FFMPEG_PATH = FFMPEG;
    process.env.FFPROBE_PATH = FFPROBE;
    ctx = await createAuthorizationMatrixE2EContext();
    library = await createLibraryWithFolder(ctx, { name: `chapter-write-${randomUUID()}` });
    await setWriteBack(true);
  });

  afterAll(async () => {
    await closeAuthorizationMatrixE2EContext(ctx);
  });

  it('splits the chapters across a multi-file book and reads back the same book', async () => {
    const parts = [
      { name: 'Part 1.mp3', seconds: 20 },
      { name: 'Part 2.mp3', seconds: 20 },
      { name: 'Part 3.mp3', seconds: 20 },
    ];
    const slugFolder = join(library.folderPath, `parts-${randomUUID()}`);
    await Promise.all(parts.map((part) => makeAudio(join(slugFolder, part.name), part.seconds)));
    const { bookId, paths } = await seedBookFrom(slugFolder, 'Three Parts', parts);
    const saved = await save(bookId, [
      { title: 'Opening', startMs: 0 },
      { title: 'One', startMs: 5_000 },
      { title: 'Two', startMs: 30_000 },
      { title: 'Three', startMs: 45_000 },
    ]);
    expect(saved.writeBack).toEqual({ available: true, reason: null, fileCount: 3 });
    const starts = saved.tracks.map((track) => track.startMs!);

    const response = await write(bookId, saved.revision);

    expect(response.statusCode).toBe(200);
    expect(response.json<WriteBookChaptersResult>()).toEqual({ status: 'success', filesWritten: 3, filesTotal: 3 });
    const probed = await Promise.all(paths.map((path) => probe(path)));
    expect(probed.map((file) => file.chapters.map(({ title, startMs }) => [title, startMs]))).toEqual([
      [
        ['Opening', 0],
        ['One', 5_000],
      ],
      // "One" is still playing when the second file opens, so that file starts by naming it.
      [
        ['One', 0],
        ['Two', 30_000 - starts[1]!],
      ],
      [
        ['Two', 0],
        ['Three', 45_000 - starts[2]!],
      ],
    ]);
    probed.forEach((file) => expect(file.chapters.at(-1)!.endMs).toBeCloseTo(file.durationMs, -2));

    // The e2e app stubs out metadata reading, so merge the files here with the scanner's own merge.
    const readBack = mergeAudioChapters(
      probed.map((file, index) => ({
        absolutePath: paths[index]!,
        chapters: file.chapters.map(({ title, startMs }) => ({ title, startMs })),
        durationMs: file.durationMs,
      })),
    )!;
    expect(readBack.map((chapter) => chapter.title)).toEqual(['Opening', 'One', 'Two', 'Three']);
    readBack.forEach((chapter, index) => expect(Math.abs(chapter.startMs - saved.chapters[index]!.startMs)).toBeLessThan(250));
  });

  it('replaces the chapters of an M4B that already has some and keeps the rest of the file', async () => {
    const folder = join(library.folderPath, `m4b-${randomUUID()}`);
    const part = { name: 'Book.m4b', seconds: 30 };
    await makeAudio(join(folder, part.name), part.seconds, [
      { title: 'Old A', startMs: 0, endMs: 15_000 },
      { title: 'Old B', startMs: 15_000, endMs: 30_000 },
    ]);
    const { bookId, paths } = await seedBookFrom(folder, 'One M4B', [part]);
    const saved = await save(bookId, [
      { title: 'New A', startMs: 0 },
      { title: 'New B', startMs: 10_000 },
      { title: 'New C', startMs: 20_000 },
    ]);

    expect((await write(bookId, saved.revision)).json<WriteBookChaptersResult>().status).toBe('success');
    const written = await probe(paths[0]!);
    expect(written.chapters.map(({ title, startMs }) => [title, startMs])).toEqual([
      ['New A', 0],
      ['New B', 10_000],
      ['New C', 20_000],
    ]);

    // A plain metadata write-back of an M4B with chapters used to fail copying the chapter track.
    const metadataWrite = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/books/${bookId}/write-and-rename`,
      headers: authHeader(ctx.adminToken),
    });
    expect(metadataWrite.statusCode).toBe(201);
    expect(metadataWrite.json<{ write: { status: string } }>().write.status).toBe('success');
    // Write-and-rename may also move the file to the library's naming pattern.
    const [file] = await ctx.db
      .select({ absolutePath: schema.bookFiles.absolutePath })
      .from(schema.bookFiles)
      .where(eq(schema.bookFiles.bookId, bookId));
    expect((await probe(file!.absolutePath)).chapters.map((chapter) => chapter.title)).toEqual(['New A', 'New B', 'New C']);
  });

  it('refuses a stale list, a library without write-back and a format that cannot hold chapters', async () => {
    const folder = join(library.folderPath, `refusals-${randomUUID()}`);
    const part = { name: 'Book.mp3', seconds: 10 };
    await makeAudio(join(folder, part.name), part.seconds);
    const { bookId } = await seedBookFrom(folder, 'Refusals', [part]);
    const first = await save(bookId, [{ title: 'Only', startMs: 0 }]);
    const second = await save(bookId, [
      { title: 'Only', startMs: 0 },
      { title: 'Later', startMs: 5_000 },
    ]);

    const stale = await write(bookId, first.revision);
    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ errorCode: string }>().errorCode).toBe(BOOK_CHAPTERS_ERROR_CODES.stale);

    await setWriteBack(false);
    try {
      expect((await getState(bookId)).writeBack).toEqual({ available: false, reason: 'library_disabled', fileCount: 1 });
      const disabled = await write(bookId, second.revision);
      expect(disabled.statusCode).toBe(409);
      expect(disabled.json<{ errorCode: string; errorMeta: { reason: string } }>()).toMatchObject({
        errorCode: BOOK_CHAPTERS_ERROR_CODES.writeUnavailable,
        errorMeta: { reason: 'library_disabled' },
      });
    } finally {
      await setWriteBack(true);
    }

    const flacFolder = join(library.folderPath, `flac-${randomUUID()}`);
    const flac = { name: 'Book.flac', seconds: 5 };
    await mkdir(flacFolder, { recursive: true });
    await execFile(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=duration=5', join(flacFolder, flac.name)]);
    const { bookId: flacBookId } = await seedBookFrom(flacFolder, 'Flac', [flac]);
    expect((await getState(flacBookId)).writeBack).toEqual({ available: false, reason: 'format_not_supported', fileCount: 1 });
  });

  /** Seeds a book over files already made in `folder`, keeping their real sizes and lengths. */

  it('roundtrips fractional file durations and a chapter that continues from zero using verified provenance', async () => {
    const parts = [
      { name: 'Part 1.m4b', seconds: 20.4 },
      { name: 'Part 2.m4b', seconds: 20.4 },
    ];
    const folder = join(library.folderPath, `fractional-${randomUUID()}`);
    for (const part of parts) await makeAudio(join(folder, part.name), part.seconds);
    const seeded = await seedBookFrom(folder, 'Fractional timeline', parts);
    const saved = await save(seeded.bookId, [
      { title: 'One', startMs: 0 },
      { title: 'Two', startMs: 30000 },
    ]);
    expect((await write(seeded.bookId, saved.revision)).json<WriteBookChaptersResult>()).toMatchObject({ status: 'success', filesWritten: 2 });
    const actual = await MetadataService.prototype.readEmbeddedChapters.call(
      { audiobookChapters: ctx.app.get(AudiobookChaptersService) } as never,
      seeded.paths,
      seeded.bookId,
    );
    expect(actual).toEqual(saved.chapters);
  });

  it('retains the text following an interior carriage return when writing chapters', async () => {
    const folder = join(library.folderPath, `carriage-${randomUUID()}`);
    await makeAudio(join(folder, 'Part 1.m4b'), 10);
    const seeded = await seedBookFrom(folder, 'Carriage return', [{ name: 'Part 1.m4b' }]);
    const saved = await save(seeded.bookId, [{ title: 'Hello\rWorld', startMs: 0 }]);
    expect((await write(seeded.bookId, saved.revision)).json<WriteBookChaptersResult>()).toMatchObject({ status: 'success' });
    expect((await probe(seeded.paths[0])).chapters[0].title).toBe('Hello\nWorld');
  });

  it('refuses an old write snapshot when metadata changes while it waits for the book lock', async () => {
    const folder = join(library.folderPath, `waiting-${randomUUID()}`);
    await makeAudio(join(folder, 'Book.m4b'), 10);
    const seeded = await seedBookFrom(folder, 'Queued snapshot', [{ name: 'Book.m4b' }]);
    const saved = await save(seeded.bookId, [{ title: 'Before', startMs: 0 }]);
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocker = ctx.app.get(FileLockService).withLock(bookOperationLockKey(seeded.bookId), async () => {
      entered();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    await ready;
    const response = write(seeded.bookId, saved.revision);
    try {
      await ctx.db
        .update(schema.bookMetadata)
        .set({ chapters: [{ title: 'After', startMs: 0 }], chaptersUpdatedAt: new Date() })
        .where(eq(schema.bookMetadata.bookId, seeded.bookId));
    } finally {
      release();
    }
    await blocker;
    expect((await response).statusCode).toBe(409);
    expect((await probe(seeded.paths[0])).chapters).toEqual([]);
  });

  it('preserves an unregistered pre-upgrade revision before a harmless tag write', async () => {
    const folder = join(library.folderPath, `legacy-${randomUUID()}`);
    await makeAudio(join(folder, 'Book.m4b'), 10);
    const seeded = await seedBookFrom(folder, 'Legacy offline tags', [{ name: 'Book.m4b' }]);
    const files = await ctx.db.select().from(schema.bookFiles).where(eq(schema.bookFiles.bookId, seeded.bookId));
    const legacy = computeAudiobookManifestRevision(orderAudiobookTracks(files), []);
    const changed = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/books/${seeded.bookId}/write-and-rename`,
      headers: authHeader(ctx.adminToken),
    });
    expect(changed.json<{ write: { status: string } }>().write.status).toBe('success');
    const manifest = (
      await ctx.app.inject({ method: 'GET', url: `/api/v1/audiobooks/${seeded.bookId}/manifest`, headers: authHeader(ctx.adminToken) })
    ).json<AudiobookManifest>();
    const playback = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/audiobooks/${seeded.bookId}/playback-state`,
      headers: authHeader(ctx.adminToken),
      payload: {
        assetId: manifest.assets[0].assetId,
        positionMs: 2000,
        capturedAt: new Date().toISOString(),
        operationId: randomUUID(),
        baseRevision: 0,
        manifestRevision: legacy,
      },
    });
    expect(playback.statusCode).toBe(200);
  });

  it('runs a recoverable chapter job once for a repeated revision request and exposes progress', async () => {
    const folder = join(library.folderPath, `job-${randomUUID()}`);
    await makeAudio(join(folder, 'Part 1.m4b'), 10);
    const seeded = await seedBookFrom(folder, 'Async operation', [{ name: 'Part 1.m4b' }]);
    const saved = await save(seeded.bookId, [{ title: 'First', startMs: 0 }]);
    const start = () =>
      ctx.app.inject({
        method: 'POST',
        url: `/api/v1/books/${seeded.bookId}/chapters/jobs/write`,
        headers: authHeader(ctx.adminToken),
        payload: { baseRevision: saved.revision },
      });
    const first = (await start()).json<BookChapterJobState>();
    expect((await start()).json<BookChapterJobState>().id).toBe(first.id);
    const recovered = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/books/${seeded.bookId}/chapters/jobs`,
      headers: authHeader(ctx.adminToken),
    });
    expect(recovered.json<BookChapterJobState>().id).toBe(first.id);
    await ctx.app.get(ChapterJobService).tick();
    const status = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/books/${seeded.bookId}/chapters/jobs/${first.id}`,
      headers: authHeader(ctx.adminToken),
    });
    expect(status.json<BookChapterJobState>()).toMatchObject({ status: 'success', filesWritten: 1, filesTotal: 1, result: { status: 'success' } });
  });

  it('reads embedded chapters again after a completed job instead of caching them by editor revision', async () => {
    const folder = join(library.folderPath, `read-job-${randomUUID()}`);
    await makeAudio(join(folder, 'Book.m4b'), 10);
    const seeded = await seedBookFrom(folder, 'Fresh embedded reads', [{ name: 'Book.m4b' }]);
    const readChapters = vi
      .fn()
      .mockResolvedValueOnce([{ title: 'First read', startMs: 0 }])
      .mockResolvedValueOnce([{ title: 'Fresh read', startMs: 0 }]);
    Object.assign(ctx.metadataMock, { readEmbeddedChapters: readChapters });
    const baseRevision = (await getState(seeded.bookId)).revision;
    for (const title of ['First read', 'Fresh read']) {
      const reading = (
        await ctx.app.inject({
          method: 'POST',
          url: `/api/v1/books/${seeded.bookId}/chapters/jobs/read`,
          headers: authHeader(ctx.adminToken),
          payload: { baseRevision },
        })
      ).json<BookChapterJobState>();
      expect(reading.status).toBe('queued');
      await ctx.app.get(ChapterJobService).tick();
      const completed = (
        await ctx.app.inject({
          method: 'GET',
          url: `/api/v1/books/${seeded.bookId}/chapters/jobs/${reading.id}`,
          headers: authHeader(ctx.adminToken),
        })
      ).json<BookChapterJobState>();
      expect(completed).toMatchObject({ status: 'success', result: { chapters: [{ title, startMs: 0 }] } });
    }
  });

  async function seedBookFrom(folder: string, title: string, parts: { name: string }[]) {
    const relFolder = folder.slice(library.folderPath.length + 1);
    const [book] = await ctx.db
      .insert(schema.books)
      .values({ libraryId: library.libraryId, libraryFolderId: library.libraryFolderId, folderPath: folder, status: 'present' })
      .returning({ id: schema.books.id });
    await ctx.db.insert(schema.bookMetadata).values({ bookId: book!.id, title });
    const paths = parts.map((part) => join(folder, part.name));
    const rows = [];
    for (const [index, part] of parts.entries()) {
      const { durationMs } = await probe(paths[index]!);
      rows.push({
        bookId: book!.id,
        libraryFolderId: library.libraryFolderId,
        absolutePath: paths[index]!,
        relPath: `${relFolder}/${part.name}`,
        ino: BigInt(Math.floor(Math.random() * 1e12)),
        sizeBytes: (await stat(paths[index]!)).size,
        format: part.name.split('.').pop()!,
        role: 'content' as const,
        sortOrder: index + 1,
        durationSeconds: Math.round(durationMs / 1000),
      });
    }
    const files = await ctx.db.insert(schema.bookFiles).values(rows).returning({ id: schema.bookFiles.id });
    await ctx.db.update(schema.books).set({ primaryFileId: files[0]!.id }).where(eq(schema.books.id, book!.id));
    return { bookId: book!.id, paths };
  }
});
