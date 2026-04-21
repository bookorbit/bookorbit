import { mkdir, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

export interface UsersAdminLifecycleFixtureRoot {
  rootPath: string;
  booksPath: string;
  bookDockPath: string;
  cleanup: () => Promise<void>;
}

export async function createUsersAdminLifecycleFixtureRoot(prefix = 'users-admin-lifecycle-e2e-'): Promise<UsersAdminLifecycleFixtureRoot> {
  const rootPath = await mkdtemp(join(tmpdir(), prefix));
  const booksPath = join(rootPath, 'books');
  const bookDockPath = join(booksPath, 'book-dock');
  await mkdir(bookDockPath, { recursive: true });

  return {
    rootPath,
    booksPath,
    bookDockPath,
    cleanup: async () => {
      await rm(rootPath, { recursive: true, force: true });
    },
  };
}
