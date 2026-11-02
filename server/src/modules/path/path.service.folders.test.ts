import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { PathService } from './path.service';

const runningAsRoot = typeof process.getuid === 'function' && process.getuid() === 0;

describe('PathService folder picker routes', () => {
  let root: string;
  let service: PathService;
  const pathPolicy = {
    getBrowseRoot: vi.fn(),
    getAppDataPath: vi.fn(),
    getCanonicalAppDataPath: vi.fn(),
    resolveBrowsePath: vi.fn(),
  };
  const pathRepository = { findLibraryFolders: vi.fn() };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'path-folders-'));
    await mkdir(join(root, 'books', 'Ebooks', 'Fiction'), { recursive: true });
    await mkdir(join(root, 'books', 'Magazines'), { recursive: true });
    await mkdir(join(root, 'books', '.hidden'), { recursive: true });
    await mkdir(join(root, 'data', 'covers'), { recursive: true });
    await writeFile(join(root, 'books', 'Loose.epub'), 'x');
    await symlink(join(root, 'books', 'Ebooks'), join(root, 'books', 'Linked'));

    pathPolicy.getBrowseRoot.mockReturnValue(root);
    pathPolicy.getAppDataPath.mockReturnValue(join(root, 'data'));
    pathPolicy.getCanonicalAppDataPath.mockResolvedValue(join(root, 'data'));
    pathPolicy.resolveBrowsePath.mockImplementation((path?: string) => Promise.resolve(path || root));
    pathRepository.findLibraryFolders.mockResolvedValue([]);
    service = new PathService(pathPolicy as never, pathRepository as never);
  });

  afterEach(async () => {
    await chmod(join(root, 'books'), 0o755).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });

  describe('listFolder', () => {
    it('lists real folders with whether each has folders of its own, skipping files, hidden folders and symlinks', async () => {
      const listing = await service.listFolder(join(root, 'books'));

      expect(listing.state).toBe('ok');
      expect(listing.entries.map((entry) => [entry.name, entry.hasChildren, entry.system, entry.appData])).toEqual([
        ['Ebooks', true, false, false],
        ['Magazines', false, false, false],
      ]);
    });

    it('lists a folder of hundreds of folders by name alone, without peeking inside each one', async () => {
      for (let i = 0; i < 401; i++) await mkdir(join(root, 'books', 'Ebooks', 'Fiction', `Author ${i}`));

      const listing = await service.listFolder(join(root, 'books', 'Ebooks', 'Fiction'));

      expect(listing.entries).toHaveLength(401);
      expect(listing.entries.every((entry) => entry.hasChildren === null)).toBe(true);
    });

    it('lists only the first folders by name from a folder of thousands, and says so', async () => {
      const crowded = join(root, 'books', 'Ebooks', 'Fiction');
      for (let i = 0; i <= 5_000; i++) await mkdir(join(crowded, `Author ${String(i).padStart(4, '0')}`));

      const listing = await service.listFolder(crowded);

      expect(listing.truncated).toBe(true);
      expect(listing.entries).toHaveLength(5_000);
      expect(listing.entries.at(-1)?.name).toBe('Author 4999');
    });

    it('marks BookOrbit’s data folder', async () => {
      const listing = await service.listFolder(root);

      expect(listing.truncated).toBe(false);
      expect(listing.entries.find((entry) => entry.name === 'data')?.appData).toBe(true);
      expect(listing.entries.find((entry) => entry.name === 'books')?.appData).toBe(false);
    });

    it('marks the data folder when the listing reaches it through a symlink', async () => {
      await mkdir(join(root, 'real', 'inner', 'data'), { recursive: true });
      await symlink(join(root, 'real'), join(root, 'via'));
      pathPolicy.getAppDataPath.mockReturnValue(join(root, 'real', 'inner', 'data'));
      pathPolicy.getCanonicalAppDataPath.mockResolvedValue(await realpath(join(root, 'real', 'inner', 'data')));

      const listing = await service.listFolder(join(root, 'via', 'inner'));

      expect(listing.entries).toMatchObject([{ name: 'data', appData: true }]);
    });

    it('says a missing folder is missing rather than empty', async () => {
      await expect(service.listFolder(join(root, 'gone'))).resolves.toEqual({
        path: join(root, 'gone'),
        state: 'missing',
        entries: [],
        truncated: false,
      });
    });

    it('never opens blocked system paths', async () => {
      pathPolicy.resolveBrowsePath.mockResolvedValue('/proc');

      await expect(service.listFolder('/proc')).resolves.toEqual({ path: '/proc', state: 'blocked', entries: [], truncated: false });
    });

    it('refuses a symlinked folder', async () => {
      await expect(service.listFolder(join(root, 'books', 'Linked'))).resolves.toMatchObject({ state: 'blocked', entries: [] });
    });

    it('refuses a folder reached through a symlink into a blocked system path', async () => {
      await symlink('/dev', join(root, 'dev-link'));

      await expect(service.listFolder(join(root, 'dev-link', 'fd'))).resolves.toMatchObject({ state: 'blocked', entries: [] });
    });

    it.skipIf(runningAsRoot)('says a folder it may not read is denied', async () => {
      await chmod(join(root, 'books'), 0o000);

      await expect(service.listFolder(join(root, 'books'))).resolves.toMatchObject({ state: 'denied', entries: [] });
    });
  });

  describe('searchFolders', () => {
    it('finds folders by name anywhere below, ignoring case', async () => {
      await expect(service.searchFolders('FICT')).resolves.toEqual({ results: [join(root, 'books', 'Ebooks', 'Fiction')], truncated: false });
    });

    it('returns nothing for a blank query', async () => {
      await expect(service.searchFolders('   ')).resolves.toEqual({ results: [], truncated: false });
    });

    it('does not follow symlinks or hidden folders', async () => {
      const { results } = await service.searchFolders('e');

      expect(results.some((path) => path.includes('Linked') || path.includes('.hidden'))).toBe(false);
    });

    it('does not search below a symlink into a blocked system path', async () => {
      await symlink('/dev', join(root, 'dev-link'));

      await expect(service.searchFolders('fd', join(root, 'dev-link'))).resolves.toEqual({ results: [], truncated: false });
    });

    it('matches a name stored decomposed when the query is typed composed', async () => {
      await mkdir(join(root, 'books', 'Cafe\u0301 Stories'));

      const { results } = await service.searchFolders('café');

      expect(results).toEqual([join(root, 'books', 'Cafe\u0301 Stories')]);
    });

    it('says the results may be incomplete when folders lie deeper than it looks', async () => {
      await mkdir(join(root, 'books', 'a', 'b', 'c', 'd', 'e', 'f', 'Deep Find'), { recursive: true });

      await expect(service.searchFolders('deep find')).resolves.toEqual({ results: [], truncated: true });
    });
  });

  describe('getPlaces', () => {
    it('groups every library’s folders and offers the root when nothing is mounted separately', async () => {
      pathRepository.findLibraryFolders.mockResolvedValue([
        { libraryId: 1, name: 'Novels', icon: 'BookOpen', path: join(root, 'books', 'Ebooks', 'Fiction') },
        { libraryId: 2, name: 'Magazines', icon: null, path: join(root, 'books', 'Magazines') },
        { libraryId: 1, name: 'Novels', icon: 'BookOpen', path: join(root, 'books', 'Extra') },
      ]);

      await expect(service.getPlaces()).resolves.toEqual({
        root,
        mounts: [root],
        appDataPath: join(root, 'data'),
        libraries: [
          {
            id: 1,
            name: 'Novels',
            icon: 'BookOpen',
            folders: [join(root, 'books', 'Ebooks', 'Fiction'), join(root, 'books', 'Extra')],
          },
          { id: 2, name: 'Magazines', icon: null, folders: [join(root, 'books', 'Magazines')] },
        ],
      });
    });

    it('leaves out a data folder that sits outside the browse root', async () => {
      pathPolicy.getCanonicalAppDataPath.mockResolvedValue('/elsewhere/data');

      await expect(service.getPlaces()).resolves.toMatchObject({ appDataPath: null });
    });
  });
});
