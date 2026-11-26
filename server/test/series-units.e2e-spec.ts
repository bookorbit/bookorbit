import { randomUUID } from 'crypto';

import { eq } from 'drizzle-orm';

import {
  FOLDER_SERIES_REGEX_METADATA,
  type BookDetail,
  type SeriesBooksPage,
  type SeriesNextBookResponse,
  type SeriesPage,
  type SeriesUnit,
} from '@bookorbit/types';

import { APP_SETTING_KEYS } from '../src/common/constants/app-settings.constants';
import { normalizeMetadataTextKey } from '../src/common/utils/metadata-text-normalize.utils';
import * as schema from '../src/db/schema';
import { SeriesUnitBackfillService } from '../src/modules/series-unit-backfill/series-unit-backfill.service';
import {
  authHeader,
  closeAuthorizationMatrixE2EContext,
  createAuthorizationMatrixE2EContext,
  createLibraryWithFolder,
  createUserAndLogin,
  type AuthorizationMatrixE2EContext,
  type CreatedLibrary,
  type TestUserSession,
} from './e2e/authorization-matrix/authorization-matrix-harness';

const SCENARIO_TIMEOUT_MS = 60_000;

/**
 * A series holding volumes and chapters keeps them on separate number lines: volumes (with
 * unclassified books) list first, `unit` narrows the list and its total, next-in-series stays on
 * the line being read, and a chapter never fills or hides a missing volume.
 */
describe('Series units (e2e)', { timeout: SCENARIO_TIMEOUT_MS }, () => {
  let ctx!: AuthorizationMatrixE2EContext;
  let library!: CreatedLibrary;
  let admin!: TestUserSession;

  let mixedSeries = 0;
  let hiddenGapSeries = 0;
  const mixed: Record<string, number> = {};
  let inoSequence = 970_000;

  // Named as a save would name it, so a metadata edit resolves to this same series.
  async function createSeries(name: string, expectedBookCount: number | null = null): Promise<number> {
    const [series] = await ctx.db
      .insert(schema.bookSeries)
      .values({ name, normalizedName: normalizeMetadataTextKey(name)!, expectedBookCount })
      .returning({ id: schema.bookSeries.id });
    return series!.id;
  }

  async function seedBook(
    target: CreatedLibrary,
    seriesId: number,
    seriesName: string,
    fileName: string,
    seriesIndex: string | null,
    unit: SeriesUnit | null,
  ): Promise<number> {
    const slug = `${seriesName.toLowerCase().replaceAll(' ', '-')}-${randomUUID()}`;
    const [book] = await ctx.db
      .insert(schema.books)
      .values({ libraryId: target.libraryId, libraryFolderId: target.libraryFolderId, folderPath: `${target.folderPath}/${slug}`, status: 'present' })
      .returning({ id: schema.books.id });
    const bookId = book!.id;
    await ctx.db
      .insert(schema.bookMetadata)
      .values({ bookId, title: fileName, seriesId, seriesName, seriesIndex, seriesUnit: unit, lockedFields: [] });
    inoSequence += 1;
    const [file] = await ctx.db
      .insert(schema.bookFiles)
      .values({
        bookId,
        libraryFolderId: target.libraryFolderId,
        absolutePath: `${target.folderPath}/${seriesName}/${fileName}`,
        relPath: `${seriesName}/${fileName}`,
        ino: BigInt(inoSequence),
        sizeBytes: 2048,
        format: 'cbz',
        role: 'content',
      })
      .returning({ id: schema.bookFiles.id });
    await ctx.db.update(schema.books).set({ primaryFileId: file!.id }).where(eq(schema.books.id, bookId));
    await ctx.db.insert(schema.bookSeriesMemberships).values({ bookId, seriesId, seriesIndex, seriesUnit: unit, displayOrder: 0 });
    return bookId;
  }

  async function get<T>(url: string): Promise<T> {
    const response = await ctx.app.inject({ method: 'GET', url: `/api/v1${url}`, headers: authHeader(admin.accessToken) });
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as T;
  }

  async function seriesBooks(seriesId: number, query = ''): Promise<SeriesBooksPage> {
    return get<SeriesBooksPage>(`/series/${seriesId}/books?size=100${query}`);
  }

  beforeAll(async () => {
    ctx = await createAuthorizationMatrixE2EContext();
    library = await createLibraryWithFolder(ctx, { name: `series-units-${randomUUID()}` });
    admin = await createUserAndLogin(ctx, { isSuperuser: true });

    mixedSeries = await createSeries('Berserk Mixed');
    mixed.c1 = await seedBook(library, mixedSeries, 'Berserk Mixed', 'Berserk c001.cbz', '1', 'chapter');
    mixed.v2 = await seedBook(library, mixedSeries, 'Berserk Mixed', 'Berserk v02.cbz', '2', 'volume');
    mixed.c2 = await seedBook(library, mixedSeries, 'Berserk Mixed', 'Berserk c002.cbz', '2', 'chapter');
    mixed.v1 = await seedBook(library, mixedSeries, 'Berserk Mixed', 'Berserk v01.cbz', '1', 'volume');
    mixed.c4 = await seedBook(library, mixedSeries, 'Berserk Mixed', 'Berserk c004.cbz', '4', 'chapter');
    mixed.loose = await seedBook(library, mixedSeries, 'Berserk Mixed', 'Berserk 003.cbz', '3', null);

    // Volume 2 is missing; chapter 2 must not hide it.
    hiddenGapSeries = await createSeries('Hidden Gap');
    await seedBook(library, hiddenGapSeries, 'Hidden Gap', 'Hidden Gap v01.cbz', '1', 'volume');
    await seedBook(library, hiddenGapSeries, 'Hidden Gap', 'Hidden Gap c002.cbz', '2', 'chapter');
    await seedBook(library, hiddenGapSeries, 'Hidden Gap', 'Hidden Gap v03.cbz', '3', 'volume');
  });

  afterAll(async () => {
    await closeAuthorizationMatrixE2EContext(ctx);
  });

  it('lists volumes and unclassified books before chapters, each by number', async () => {
    const page = await seriesBooks(mixedSeries);

    expect(page.items.map((item) => item.id)).toEqual([mixed.v1, mixed.v2, mixed.loose, mixed.c1, mixed.c2, mixed.c4]);
    expect(page.items.map((item) => item.seriesUnit)).toEqual(['volume', 'volume', null, 'chapter', 'chapter', 'chapter']);
  });

  it('narrows the list and its total to one unit class', async () => {
    const volumes = await seriesBooks(mixedSeries, '&unit=volume');
    const chapters = await seriesBooks(mixedSeries, '&unit=chapter');

    expect(volumes.items.map((item) => item.id)).toEqual([mixed.v1, mixed.v2, mixed.loose]);
    expect(volumes.total).toBe(3);
    expect(chapters.items.map((item) => item.id)).toEqual([mixed.c1, mixed.c2, mixed.c4]);
    expect(chapters.total).toBe(3);
  });

  it('rejects a unit the server does not know', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/series/${mixedSeries}/books?unit=issue`,
      headers: authHeader(admin.accessToken),
    });

    expect(response.statusCode).toBe(400);
  });

  it('counts each unit and names gaps per line', async () => {
    const { seriesInfo } = await seriesBooks(mixedSeries);

    expect(seriesInfo.unitCounts).toEqual({ volume: 3, chapter: 3, issue: 0 });
    expect(seriesInfo.possibleGaps).toEqual([]);
    expect(seriesInfo.chapterGaps).toEqual([3]);
    expect(seriesInfo.ownedVolumeCount).toBe(3);
    expect(seriesInfo.chapterReadCount).toBe(0);
  });

  it('keeps next in series on the line being read', async () => {
    const fromVolume = await get<SeriesNextBookResponse>(`/series/${mixedSeries}/books/${mixed.v1}/next?formatGroup=cbx`);
    const fromChapter = await get<SeriesNextBookResponse>(`/series/${mixedSeries}/books/${mixed.c2}/next?formatGroup=cbx`);
    const fromLastVolume = await get<SeriesNextBookResponse>(`/series/${mixedSeries}/books/${mixed.loose}/next?formatGroup=cbx`);

    expect(fromVolume.next).toMatchObject({ bookId: mixed.v2, seriesUnit: 'volume' });
    expect(fromChapter.next).toMatchObject({ bookId: mixed.c4, seriesUnit: 'chapter' });
    expect(fromLastVolume.next).toBeNull();
  });

  it('never lets a chapter hide a missing volume, on the series page and the Gaps tab alike', async () => {
    const { seriesInfo } = await seriesBooks(hiddenGapSeries);
    const gapsTab = await get<SeriesPage>(`/series?completionStatus=has_gaps&size=100&libraryId=${library.libraryId}`);
    const list = await get<SeriesPage>(`/series?size=100&libraryId=${library.libraryId}`);

    expect(seriesInfo.possibleGaps).toEqual([2]);
    expect(gapsTab.items.map((item) => item.id).sort((a, b) => a - b)).toEqual([mixedSeries, hiddenGapSeries].sort((a, b) => a - b));
    const summary = list.items.find((item) => item.id === mixedSeries)!;
    expect(summary.unitCounts).toEqual({ volume: 3, chapter: 3, issue: 0 });
    expect(summary.chapterGaps).toEqual([3]);
    expect(summary.volumes.map((slot) => slot.index)).toEqual([1, 2, 3]);
  });

  it('keeps a unit when a save leaves it out and clears it on null', async () => {
    const patch = async (unit?: SeriesUnit | null) => {
      const membership = { seriesName: 'Berserk Mixed', seriesIndex: '4', ...(unit === undefined ? {} : { unit }) };
      const response = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/books/${mixed.c4}/metadata`,
        headers: authHeader(admin.accessToken),
        payload: { seriesMemberships: [membership] },
      });
      expect(response.statusCode, response.body).toBe(200);
      return (await get<BookDetail>(`/books/${mixed.c4}`)).seriesMemberships?.[0]?.unit;
    };

    expect(await patch()).toBe('chapter');
    expect(await patch(null)).toBeNull();
    expect(await patch('issue')).toBe('issue');
    expect(await patch('chapter')).toBe('chapter');

    // A save that renames the series, as a released build would send it, keeps the book's unit.
    const renamed = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/books/${mixed.c4}/metadata`,
      headers: authHeader(admin.accessToken),
      payload: { seriesMemberships: [{ seriesName: `Berserk Renamed ${randomUUID().slice(0, 8)}`, seriesIndex: '4' }] },
    });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect((await get<BookDetail>(`/books/${mixed.c4}`)).seriesMemberships?.[0]?.unit).toBe('chapter');
  });

  it('gives existing comic books the unit their file name names, once, leaving locked and bare-numbered books alone', async () => {
    const rulesLibrary = await createLibraryWithFolder(ctx, { name: `series-units-rules-${randomUUID()}` });
    await ctx.db.update(schema.libraries).set({ regexMetadata: FOLDER_SERIES_REGEX_METADATA }).where(eq(schema.libraries.id, rulesLibrary.libraryId));
    const seriesId = await createSeries('Vagabond');
    const volume = await seedBook(rulesLibrary, seriesId, 'Vagabond', 'Vagabond v01.cbz', '1', null);
    const chapter = await seedBook(rulesLibrary, seriesId, 'Vagabond', 'Vagabond v03 c012.cbz', '12', null);
    const bare = await seedBook(rulesLibrary, seriesId, 'Vagabond', 'Vagabond 005.cbz', '5', null);
    const disagreeing = await seedBook(rulesLibrary, seriesId, 'Vagabond', 'Vagabond c020.cbz', '7', null);
    const locked = await seedBook(rulesLibrary, seriesId, 'Vagabond', 'Vagabond c030.cbz', '30', null);
    await ctx.db
      .update(schema.bookMetadata)
      .set({ lockedFields: ['seriesIndex'] })
      .where(eq(schema.bookMetadata.bookId, locked));
    // A membership that already has a unit keeps it, even when the book's own metadata has none.
    const classified = await seedBook(rulesLibrary, seriesId, 'Vagabond', 'Vagabond c040.cbz', '40', null);
    await ctx.db.update(schema.bookSeriesMemberships).set({ seriesUnit: 'issue' }).where(eq(schema.bookSeriesMemberships.bookId, classified));
    await ctx.db.delete(schema.appSettings).where(eq(schema.appSettings.key, APP_SETTING_KEYS.SERIES_UNITS_BACKFILLED));

    const backfill = ctx.app.get(SeriesUnitBackfillService);
    await backfill.runOnce();

    const units = async (bookId: number) => {
      const [row] = await ctx.db
        .select({ unit: schema.bookSeriesMemberships.seriesUnit, volumeIndex: schema.bookSeriesMemberships.seriesVolumeIndex })
        .from(schema.bookSeriesMemberships)
        .where(eq(schema.bookSeriesMemberships.bookId, bookId));
      return row;
    };
    expect(await units(volume)).toEqual({ unit: 'volume', volumeIndex: null });
    expect(await units(chapter)).toEqual({ unit: 'chapter', volumeIndex: '3' });
    expect(await units(bare)).toEqual({ unit: null, volumeIndex: null });
    expect(await units(disagreeing)).toEqual({ unit: null, volumeIndex: null });
    expect(await units(locked)).toEqual({ unit: null, volumeIndex: null });
    expect(await units(classified)).toEqual({ unit: 'issue', volumeIndex: null });

    // A second boot finds the flag and does nothing, even for a book cleared since.
    await ctx.db.update(schema.bookMetadata).set({ seriesUnit: null }).where(eq(schema.bookMetadata.bookId, volume));
    await expect(backfill.runOnce()).resolves.toBeNull();
    const [metadata] = await ctx.db
      .select({ unit: schema.bookMetadata.seriesUnit })
      .from(schema.bookMetadata)
      .where(eq(schema.bookMetadata.bookId, volume));
    expect(metadata?.unit).toBeNull();
  });
});
