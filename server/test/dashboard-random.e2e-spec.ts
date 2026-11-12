import { randomUUID } from 'crypto';

import * as schema from '../src/db/schema';
import { DashboardRepository } from '../src/modules/dashboard/dashboard.repository';
import {
  closeAuthorizationMatrixE2EContext,
  createAuthorizationMatrixE2EContext,
  createLibraryWithFolder,
  createUserAndLogin,
  grantLibraryAccess,
  type AuthorizationMatrixE2EContext,
} from './e2e/authorization-matrix/authorization-matrix-harness';

const SCENARIO_TIMEOUT_MS = 60_000;

describe('Dashboard random scroller (e2e)', { timeout: SCENARIO_TIMEOUT_MS }, () => {
  let ctx!: AuthorizationMatrixE2EContext;
  let repository!: DashboardRepository;
  let libraryId!: number;
  let userId!: number;
  let bookIds!: number[];

  beforeAll(async () => {
    ctx = await createAuthorizationMatrixE2EContext();
    repository = ctx.app.get(DashboardRepository);

    const library = await createLibraryWithFolder(ctx, { name: `dashboard-random-${randomUUID()}` });
    const user = await createUserAndLogin(ctx);
    libraryId = library.libraryId;
    userId = user.userId;
    await grantLibraryAccess(ctx, userId, libraryId);

    const rows = await ctx.db
      .insert(schema.books)
      .values(
        Array.from({ length: 6 }, (_, index) => ({
          libraryId,
          libraryFolderId: library.libraryFolderId,
          folderPath: `dashboard-random-${index}`,
          status: 'present' as const,
        })),
      )
      .returning({ id: schema.books.id });
    bookIds = rows.map((row) => row.id);

    await ctx.db.insert(schema.userBookStatus).values([
      { userId, bookId: bookIds.at(-1)!, status: 'read', source: 'manual' },
      { userId, bookId: bookIds.at(-2)!, status: 'reading', source: 'manual' },
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await closeAuthorizationMatrixE2EContext(ctx);
  });

  it('uses the nearest eligible lower id when the forward probe has no candidate', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);

    await expect(repository.findRandomBookIds([libraryId], userId, 1)).resolves.toEqual([bookIds.at(-3)!]);
  });

  it('uses the forward candidate without requiring the wrap branch', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    await expect(repository.findRandomBookIds([libraryId], userId, 1)).resolves.toEqual([bookIds[0]!]);
  });

  describe('series', () => {
    let seriesLibraryIds!: number[];
    let expectedIds!: number[];

    beforeAll(async () => {
      const main = await createLibraryWithFolder(ctx, { name: `dashboard-random-series-${randomUUID()}` });
      const other = await createLibraryWithFolder(ctx, { name: `dashboard-random-series-other-${randomUUID()}` });
      await grantLibraryAccess(ctx, userId, main.libraryId);
      await grantLibraryAccess(ctx, userId, other.libraryId);
      seriesLibraryIds = [main.libraryId, other.libraryId];

      const createSeries = async (): Promise<number> => {
        const name = `dashboard-random-series-${randomUUID()}`;
        const [series] = await ctx.db.insert(schema.bookSeries).values({ name, normalizedName: name }).returning({ id: schema.bookSeries.id });
        return series!.id;
      };
      const seedBook = async (
        library: { libraryId: number; libraryFolderId: number },
        options: { seriesId?: number; seriesIndex?: string; status?: 'present' | 'missing' } = {},
      ): Promise<number> => {
        const [book] = await ctx.db
          .insert(schema.books)
          .values({
            libraryId: library.libraryId,
            libraryFolderId: library.libraryFolderId,
            folderPath: `dashboard-random-series-${randomUUID()}`,
            status: options.status ?? 'present',
          })
          .returning({ id: schema.books.id });
        await ctx.db.insert(schema.bookMetadata).values({
          bookId: book!.id,
          title: 'Series volume',
          seriesId: options.seriesId ?? null,
          seriesIndex: options.seriesIndex ?? null,
        });
        return book!.id;
      };

      const standalone = await seedBook(main);

      const unstarted = await createSeries();
      const unstartedFirst = await seedBook(main, { seriesId: unstarted, seriesIndex: '1' });
      await seedBook(main, { seriesId: unstarted, seriesIndex: '2' });
      await seedBook(main, { seriesId: unstarted, seriesIndex: '3' });

      const withNovella = await createSeries();
      await seedBook(main, { seriesId: withNovella, seriesIndex: '1' });
      const novella = await seedBook(main, { seriesId: withNovella, seriesIndex: '0.5' });

      const numeric = await createSeries();
      await seedBook(main, { seriesId: numeric, seriesIndex: '10' });
      const ninth = await seedBook(main, { seriesId: numeric, seriesIndex: '9' });

      const missingStart = await createSeries();
      await seedBook(main, { seriesId: missingStart, seriesIndex: '1', status: 'missing' });
      const firstPresent = await seedBook(main, { seriesId: missingStart, seriesIndex: '2' });
      await seedBook(main, { seriesId: missingStart, seriesIndex: '3' });

      const started = await createSeries();
      const startedFirst = await seedBook(main, { seriesId: started, seriesIndex: '1' });
      await seedBook(main, { seriesId: started, seriesIndex: '2' });
      await ctx.db.insert(schema.userBookStatus).values({ userId, bookId: startedFirst, status: 'read', source: 'manual' });

      const unnumbered = await createSeries();
      const unnumberedFirst = await seedBook(main, { seriesId: unnumbered, seriesIndex: '1' });
      const unnumberedLoose = await seedBook(main, { seriesId: unnumbered });

      const split = await createSeries();
      const splitOtherFirst = await seedBook(other, { seriesId: split, seriesIndex: '1' });
      await seedBook(other, { seriesId: split, seriesIndex: '2' });
      const splitMainFirst = await seedBook(main, { seriesId: split, seriesIndex: '3' });
      await seedBook(main, { seriesId: split, seriesIndex: '4' });

      expectedIds = [
        standalone,
        unstartedFirst,
        novella,
        ninth,
        firstPresent,
        unnumberedFirst,
        unnumberedLoose,
        splitOtherFirst,
        splitMainFirst,
      ].sort((left, right) => left - right);
    });

    it('offers each series only at its first present volume in each library', async () => {
      const ids = await repository.findRandomBookIds(seriesLibraryIds, userId, 50);

      expect([...ids].sort((left, right) => left - right)).toEqual(expectedIds);
    });
  });
});
