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
});
