import { execFile as execFileCallback } from 'child_process';
import { createRequire } from 'module';
import { copyFile, mkdir, stat } from 'fs/promises';
import { dirname, join, relative } from 'path';
import { promisify } from 'util';
import { eq } from 'drizzle-orm';

import * as schema from '../../../src/db/schema';
import { createEpubFile } from '../file-rename/file-rename-fixture-builder';
import { seedLibrary } from '../app-harness';
import {
  absJson,
  buildApiConnectionConfig,
  createUser,
  type AudiobookshelfService,
  type CreatedUser,
  type MigrationAudiobookshelfE2EContext,
} from './migration-audiobookshelf-harness';

const execFile = promisify(execFileCallback);
const requireInstaller = createRequire(__filename);
const MAYA_CFI = 'epubcfi(/6/2[chapter]!/4/2/2:5)';
const THEO_MAP_FINISHED_AT = '2025-01-15T12:30:00.000Z';
const THEO_BRASS_FINISHED_AT = '2025-02-20T08:45:00.000Z';

interface InstallerPackage {
  path: string;
}

interface AudiobookshelfItem {
  id: string;
  path: string;
  media: {
    id: string;
    metadata?: { title?: string };
  };
}

interface SeededTargetBook {
  bookId: number;
  fileIds: number[];
}

export interface AudiobookshelfMigrationScenario {
  apiConnectionConfig: Record<string, unknown>;
  pathMappings: Array<{ sourcePrefix: string; targetPrefix: string }>;
  sourceUsers: {
    maya: { id: string; token: string };
    theo: { id: string; token: string };
    lina: { id: string; token: string };
  };
  sourceItems: Record<'glass' | 'map' | 'brass' | 'northbound' | 'lanterns', AudiobookshelfItem>;
  targetUsers: { maya: CreatedUser; theo: CreatedUser };
  targetBooks: Record<'glass' | 'map' | 'brass' | 'northbound', SeededTargetBook>;
  expected: {
    mayaCfi: string;
    theoMapFinishedAt: string;
    theoBrassFinishedAt: string;
  };
}

export async function createAudiobookshelfMediaFixtures(sourceMediaRoot: string): Promise<void> {
  await Promise.all([
    createMp3File(join(sourceMediaRoot, 'The Glass Harbor', '01 - Breakwater.mp3'), {
      title: 'Breakwater',
      album: 'The Glass Harbor',
      artist: 'Avery Stone',
      track: 1,
      year: 2022,
      durationSeconds: 60,
      frequency: 320,
    }),
    createMp3File(join(sourceMediaRoot, 'The Glass Harbor', '02 - Open Water.mp3'), {
      title: 'Open Water',
      album: 'The Glass Harbor',
      artist: 'Avery Stone',
      track: 2,
      year: 2022,
      durationSeconds: 90,
      frequency: 360,
    }),
    createEpubFile(join(sourceMediaRoot, 'A Map of Quiet Stars', 'quiet-stars.epub'), 'A Map of Quiet Stars'),
    createMp3File(join(sourceMediaRoot, 'The Brass Orchard', 'brass-orchard.mp3'), {
      title: 'The Brass Orchard',
      album: 'The Brass Orchard',
      artist: 'Rina Vale',
      track: 1,
      year: 2021,
      durationSeconds: 30,
      frequency: 400,
    }),
    createEpubFile(join(sourceMediaRoot, 'Northbound at Dusk', 'northbound.epub'), 'Northbound at Dusk'),
    createMp3File(join(sourceMediaRoot, 'Northbound at Dusk', 'northbound.mp3'), {
      title: 'Northbound at Dusk',
      album: 'Northbound at Dusk',
      artist: 'June Calder',
      track: 1,
      year: 2020,
      durationSeconds: 40,
      frequency: 440,
    }),
    createEpubFile(join(sourceMediaRoot, 'Lanterns Under Snow', 'lanterns.epub'), 'Lanterns Under Snow'),
  ]);
}

export async function seedAudiobookshelfMigrationScenario(ctx: MigrationAudiobookshelfE2EContext): Promise<AudiobookshelfMigrationScenario> {
  const library = await absJson<{ id: string }>(ctx.audiobookshelf, {
    method: 'POST',
    path: '/api/libraries',
    token: ctx.audiobookshelf.rootToken,
    payload: { name: 'Synthetic Migration Library', mediaType: 'book', folders: [{ path: '/audiobooks' }] },
  });
  await absJson(ctx.audiobookshelf, {
    method: 'POST',
    path: `/api/libraries/${library.id}/scan?force=1`,
    token: ctx.audiobookshelf.rootToken,
  });

  const items = await waitForLibraryItems(ctx.audiobookshelf, library.id);
  const sourceItems = {
    glass: findItem(items, 'The Glass Harbor'),
    map: findItem(items, 'A Map of Quiet Stars'),
    brass: findItem(items, 'The Brass Orchard'),
    northbound: findItem(items, 'Northbound at Dusk'),
    lanterns: findItem(items, 'Lanterns Under Snow'),
  };

  await Promise.all([
    setItemMetadata(ctx.audiobookshelf, sourceItems.glass.id, {
      title: 'The Glass Harbor',
      authors: [{ name: 'Avery Stone' }],
      narrators: ['Morgan Hale'],
      genres: ['Literary Fiction'],
      publishedYear: '2022',
      series: [{ name: 'Harbor Cycle', sequence: '1' }],
    }),
    setItemMetadata(ctx.audiobookshelf, sourceItems.map.id, {
      title: 'A Map of Quiet Stars',
      authors: [{ name: 'Imani Reed' }],
      isbn: '9781940000001',
      genres: ['Science Fiction'],
      publishedYear: '2023',
    }),
    setItemMetadata(ctx.audiobookshelf, sourceItems.brass.id, {
      title: 'The Brass Orchard',
      authors: [{ name: 'Rina Vale' }],
      narrators: ['Elias North'],
      asin: 'B0BRASS123',
      genres: ['Fantasy'],
      publishedYear: '2021',
    }),
    setItemMetadata(ctx.audiobookshelf, sourceItems.northbound.id, {
      title: 'Northbound at Dusk',
      authors: [{ name: 'June Calder' }],
      narrators: ['Samir Wells'],
      genres: ['Adventure'],
      publishedYear: '2020',
    }),
    setItemMetadata(ctx.audiobookshelf, sourceItems.lanterns.id, {
      title: 'Lanterns Under Snow',
      authors: [{ name: 'Parker Moss' }],
      genres: ['Mystery'],
      publishedYear: '2019',
    }),
  ]);

  const maya = await createAbsUser(ctx.audiobookshelf, library.id, 'maya-chen', 'maya.chen@example.com');
  const theo = await createAbsUser(ctx.audiobookshelf, library.id, 'theo-brooks', 'theo.brooks@example.com');
  const lina = await createAbsUser(ctx.audiobookshelf, library.id, 'lina-ortiz', 'lina.ortiz@example.com');

  await Promise.all([
    setProgress(ctx.audiobookshelf, maya.token, sourceItems.glass.id, {
      duration: 150,
      currentTime: 75,
      progress: 0.5,
      isFinished: false,
      createdAt: '2025-03-01T10:00:00.000Z',
    }),
    setProgress(ctx.audiobookshelf, maya.token, sourceItems.map.id, {
      ebookProgress: 0.375,
      ebookLocation: MAYA_CFI,
      isFinished: false,
      createdAt: '2025-03-02T10:00:00.000Z',
    }),
    setProgress(ctx.audiobookshelf, maya.token, sourceItems.northbound.id, {
      duration: 40,
      currentTime: 10,
      progress: 0.25,
      ebookProgress: 0.625,
      ebookLocation: 'epubcfi(/6/2[chapter]!/4/2/2:9)',
      isFinished: false,
      createdAt: '2025-03-03T10:00:00.000Z',
    }),
    setProgress(ctx.audiobookshelf, theo.token, sourceItems.map.id, {
      ebookProgress: 1,
      isFinished: true,
      finishedAt: THEO_MAP_FINISHED_AT,
      createdAt: '2025-01-10T12:30:00.000Z',
    }),
    setProgress(ctx.audiobookshelf, theo.token, sourceItems.brass.id, {
      duration: 30,
      currentTime: 30,
      progress: 1,
      isFinished: true,
      finishedAt: THEO_BRASS_FINISHED_AT,
      createdAt: '2025-02-10T08:45:00.000Z',
    }),
    setProgress(ctx.audiobookshelf, lina.token, sourceItems.glass.id, {
      duration: 150,
      currentTime: 120,
      progress: 0.8,
      isFinished: false,
      createdAt: '2025-04-01T09:00:00.000Z',
    }),
  ]);
  await Promise.all([
    createBookmark(ctx.audiobookshelf, maya.token, sourceItems.glass.id, 42, 'Harbor entrance'),
    createBookmark(ctx.audiobookshelf, lina.token, sourceItems.glass.id, 12, 'Lina private bookmark'),
  ]);

  const targetUsers = {
    maya: await createUser(ctx, {
      username: 'migration-audiobookshelf-maya',
      name: 'Maya Chen',
      email: 'maya.chen@example.com',
    }),
    theo: await createUser(ctx, {
      username: 'migration-audiobookshelf-theo',
      name: 'Theo Brooks',
      email: 'theo.brooks@example.com',
    }),
  };
  const targetBooks = await seedTargetBooks(ctx);

  return {
    apiConnectionConfig: buildApiConnectionConfig(ctx),
    pathMappings: [{ sourcePrefix: '/audiobooks', targetPrefix: ctx.targetLibraryRoot }],
    sourceUsers: { maya, theo, lina },
    sourceItems,
    targetUsers,
    targetBooks,
    expected: { mayaCfi: MAYA_CFI, theoMapFinishedAt: THEO_MAP_FINISHED_AT, theoBrassFinishedAt: THEO_BRASS_FINISHED_AT },
  };
}

async function seedTargetBooks(ctx: MigrationAudiobookshelfE2EContext): Promise<AudiobookshelfMigrationScenario['targetBooks']> {
  const { libraryId, libraryFolderId } = await seedLibrary(ctx.db, {
    rootPath: ctx.targetLibraryRoot,
    mode: 'book_per_folder',
    name: 'Audiobookshelf Migration Target',
  });
  return {
    glass: await insertTargetBook(ctx, {
      libraryId,
      libraryFolderId,
      folderName: 'The Glass Harbor',
      files: [
        { relativePath: 'The Glass Harbor/01 - Breakwater.mp3', format: 'mp3', durationSeconds: 60 },
        { relativePath: 'The Glass Harbor/02 - Open Water.mp3', format: 'mp3', durationSeconds: 90 },
      ],
      metadata: { title: 'Target Harbor Placeholder' },
      authors: ['Target Placeholder'],
    }),
    map: await insertTargetBook(ctx, {
      libraryId,
      libraryFolderId,
      folderName: 'isbn-target',
      files: [{ relativePath: 'isbn-target/map-target.epub', format: 'epub' }],
      metadata: { title: 'Target Map Placeholder', isbn13: '9781940000001' },
      authors: ['Target Placeholder'],
    }),
    brass: await insertTargetBook(ctx, {
      libraryId,
      libraryFolderId,
      folderName: 'asin-target',
      files: [{ relativePath: 'asin-target/brass-target.mp3', format: 'mp3', durationSeconds: 30 }],
      metadata: { title: 'Target Brass Placeholder', audibleId: 'B0BRASS123' },
      authors: ['Target Placeholder'],
    }),
    northbound: await insertTargetBook(ctx, {
      libraryId,
      libraryFolderId,
      folderName: 'title-author-target',
      files: [
        { relativePath: 'title-author-target/northbound-target.epub', format: 'epub' },
        { relativePath: 'title-author-target/northbound-target.mp3', format: 'mp3', durationSeconds: 40 },
      ],
      metadata: { title: 'Northbound at Dusk' },
      authors: ['June Calder'],
    }),
  };
}

async function insertTargetBook(
  ctx: MigrationAudiobookshelfE2EContext,
  input: {
    libraryId: number;
    libraryFolderId: number;
    folderName: string;
    files: Array<{ relativePath: string; format: 'epub' | 'mp3'; durationSeconds?: number }>;
    metadata: Partial<typeof schema.bookMetadata.$inferInsert>;
    authors: string[];
  },
): Promise<SeededTargetBook> {
  const folderPath = join(ctx.targetLibraryRoot, input.folderName);
  await mkdir(folderPath, { recursive: true });
  const [book] = await ctx.db
    .insert(schema.books)
    .values({ libraryId: input.libraryId, libraryFolderId: input.libraryFolderId, folderPath })
    .returning({ id: schema.books.id });
  const fileIds: number[] = [];
  for (const [sortOrder, file] of input.files.entries()) {
    const absolutePath = join(ctx.targetLibraryRoot, file.relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    const sourcePath = sourceFixtureForTarget(ctx, input.folderName, sortOrder);
    if (sourcePath) await copyFile(sourcePath, absolutePath);
    else if (file.format === 'epub') await createEpubFile(absolutePath, `Target ${input.folderName}`);
    else
      await createMp3File(absolutePath, {
        title: `Target ${input.folderName}`,
        album: `Target ${input.folderName}`,
        artist: 'Target Artist',
        track: sortOrder + 1,
        year: 2018,
        durationSeconds: file.durationSeconds ?? 10,
        frequency: 520 + sortOrder * 20,
      });
    const fileStat = await stat(absolutePath);
    const [row] = await ctx.db
      .insert(schema.bookFiles)
      .values({
        bookId: book.id,
        libraryFolderId: input.libraryFolderId,
        absolutePath,
        relPath: relative(ctx.targetLibraryRoot, absolutePath),
        ino: fileStat.ino,
        sizeBytes: fileStat.size,
        mtime: fileStat.mtime,
        format: file.format,
        sortOrder,
        durationSeconds: file.durationSeconds,
      })
      .returning({ id: schema.bookFiles.id });
    fileIds.push(row.id);
  }
  await ctx.db.update(schema.books).set({ primaryFileId: fileIds[0] }).where(eq(schema.books.id, book.id));
  await ctx.db.insert(schema.bookMetadata).values({ bookId: book.id, ...input.metadata });
  for (const [displayOrder, authorName] of input.authors.entries()) {
    const authorId = await ensureAuthor(ctx, authorName);
    await ctx.db.insert(schema.bookAuthors).values({ bookId: book.id, authorId, displayOrder });
  }
  return { bookId: book.id, fileIds };
}

function sourceFixtureForTarget(ctx: MigrationAudiobookshelfE2EContext, folderName: string, index: number): string | null {
  if (folderName !== 'The Glass Harbor') return null;
  return join(ctx.sourceMediaRoot, folderName, index === 0 ? '01 - Breakwater.mp3' : '02 - Open Water.mp3');
}

async function ensureAuthor(ctx: MigrationAudiobookshelfE2EContext, name: string): Promise<number> {
  const existing = await ctx.db.query.authors.findFirst({ where: eq(schema.authors.name, name) });
  if (existing) return existing.id;
  const [created] = await ctx.db.insert(schema.authors).values({ name, sortName: name }).returning({ id: schema.authors.id });
  return created.id;
}

async function waitForLibraryItems(service: AudiobookshelfService, libraryId: string): Promise<AudiobookshelfItem[]> {
  let items: AudiobookshelfItem[] = [];
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const page = await absJson<{ results: Array<{ id: string }>; total: number }>(service, {
      path: `/api/libraries/${libraryId}/items?limit=20&page=0&minified=1`,
      token: service.rootToken,
    });
    if (page.total === 5 && page.results.length === 5) {
      const expanded = await absJson<{ libraryItems: AudiobookshelfItem[] }>(service, {
        method: 'POST',
        path: '/api/items/batch/get',
        token: service.rootToken,
        payload: { libraryItemIds: page.results.map((item) => item.id) },
      });
      items = expanded.libraryItems;
      if (items.length === 5) return items;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Audiobookshelf scan did not discover five fixtures (found ${items.length})`);
}

function findItem(items: AudiobookshelfItem[], folderName: string): AudiobookshelfItem {
  const item = items.find((candidate) => candidate.path.endsWith(`/${folderName}`));
  if (!item) throw new Error(`Audiobookshelf fixture item not found: ${folderName}`);
  return item;
}

async function setItemMetadata(service: AudiobookshelfService, itemId: string, metadata: Record<string, unknown>): Promise<void> {
  await absJson(service, { method: 'PATCH', path: `/api/items/${itemId}/media`, token: service.rootToken, payload: { metadata } });
}

async function createAbsUser(
  service: AudiobookshelfService,
  libraryId: string,
  username: string,
  email: string,
): Promise<{ id: string; token: string }> {
  const password = 'AudiobookshelfUser123';
  const response = await absJson<{ user: { id: string } }>(service, {
    method: 'POST',
    path: '/api/users',
    token: service.rootToken,
    payload: { username, password, email, type: 'user', isActive: true, librariesAccessible: [libraryId] },
  });
  const login = await absJson<{ user: { accessToken?: string } }>(service, { method: 'POST', path: '/login', payload: { username, password } });
  if (!login.user.accessToken) throw new Error(`Audiobookshelf login returned no token for ${username}`);
  return { id: response.user.id, token: login.user.accessToken };
}

async function setProgress(service: AudiobookshelfService, token: string, itemId: string, payload: Record<string, unknown>): Promise<void> {
  await absJson(service, { method: 'PATCH', path: `/api/me/progress/${itemId}`, token, payload });
}

async function createBookmark(service: AudiobookshelfService, token: string, itemId: string, time: number, title: string): Promise<void> {
  await absJson(service, { method: 'POST', path: `/api/me/item/${itemId}/bookmark`, token, payload: { time, title } });
}

async function createMp3File(
  absolutePath: string,
  input: { title: string; album: string; artist: string; track: number; year: number; durationSeconds: number; frequency: number },
): Promise<void> {
  const ffmpeg = requireInstaller('@ffmpeg-installer/ffmpeg') as InstallerPackage;
  await mkdir(dirname(absolutePath), { recursive: true });
  await execFile(ffmpeg.path, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=${input.frequency}:sample_rate=8000:duration=${input.durationSeconds}`,
    '-ac',
    '1',
    '-b:a',
    '16k',
    '-metadata',
    `title=${input.title}`,
    '-metadata',
    `album=${input.album}`,
    '-metadata',
    `artist=${input.artist}`,
    '-metadata',
    `track=${input.track}`,
    '-metadata',
    `date=${input.year}`,
    '-y',
    absolutePath,
  ]);
}
