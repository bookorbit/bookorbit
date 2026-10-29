import { mkdir, mkdtemp, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { FolderInsightService } from './folder-insight.service';

async function files(dir: string, names: string[]) {
  await mkdir(dir, { recursive: true });
  for (const name of names) await writeFile(join(dir, name), 'xxxx');
}

describe('FolderInsightService', () => {
  let root: string;
  let service: FolderInsightService;
  const pathPolicy = { resolveBrowsePath: vi.fn(), getAppDataPath: vi.fn(), getCanonicalAppDataPath: vi.fn() };
  const pathService = { getPlaces: vi.fn() };
  const pathRepository = { findLibraryFolders: vi.fn() };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'folder-insight-'));
    // Novels reads Fiction; Science Fiction, Cookbooks and Unsorted belong to no library.
    await files(join(root, 'books', 'Ebooks', 'Fiction', 'Jane Austen', 'Emma (1815)'), ['Emma.epub']);
    await files(join(root, 'books', 'Ebooks', 'Science Fiction', 'Ann Leckie', 'Ancillary Justice (2013)'), ['Ancillary Justice.epub']);
    await files(join(root, 'books', 'Ebooks', 'Science Fiction', 'Ann Leckie', 'Provenance (2017)'), ['Provenance.epub']);
    await files(join(root, 'books', 'Ebooks', 'Science Fiction', 'Martha Wells', 'All Systems Red (2017)'), ['All Systems Red.epub']);
    await files(join(root, 'books', 'Ebooks', 'Cookbooks'), ['Zahav.pdf', 'Jerusalem.pdf']);
    await files(join(root, 'books', 'Unsorted'), ['a.epub', 'b.epub', 'c.mobi']);
    await files(join(root, 'data', 'covers'), ['cover.epub']);

    pathPolicy.resolveBrowsePath.mockImplementation((path?: string) => Promise.resolve(path || root));
    pathPolicy.getAppDataPath.mockReturnValue(join(root, 'data'));
    pathPolicy.getCanonicalAppDataPath.mockResolvedValue(join(root, 'data'));
    pathService.getPlaces.mockResolvedValue({
      root,
      mounts: [join(root, 'books'), join(root, 'data')],
      appDataPath: join(root, 'data'),
      libraries: [],
    });
    pathRepository.findLibraryFolders.mockResolvedValue([
      { libraryId: 1, name: 'Novels', icon: null, type: 'books', path: join(root, 'books', 'Ebooks', 'Fiction') },
    ]);
    service = new FolderInsightService(pathPolicy as never, pathService as never, pathRepository as never);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe('summarize', () => {
    it('answers for each path in the order asked, keeping the caller’s spelling', async () => {
      const scifi = join(root, 'books', 'Ebooks', 'Science Fiction');
      const cookbooks = join(root, 'books', 'Ebooks', 'Cookbooks');

      const [first, second] = await service.summarize([scifi, cookbooks]);

      expect(first).toMatchObject({ path: scifi, state: 'ok', files: 3, folderBooks: 3, folders: 2, mergedFolders: 0, truncated: false });
      expect(second).toMatchObject({ path: cookbooks, files: 2, folderBooks: 2, formats: { pdf: 2 } });
    });

    it('sees the merge a parent folder would cause', async () => {
      const [ebooks] = await service.summarize([join(root, 'books', 'Ebooks')]);

      expect(ebooks).toMatchObject({ files: 6, folderBooks: 5, mergedFolders: 1 });
    });

    it('marks blocked and out-of-root paths without walking them', async () => {
      pathPolicy.resolveBrowsePath.mockImplementation((path: string) =>
        path === '/outside' ? Promise.reject(new Error('outside')) : Promise.resolve(path),
      );

      const [proc, outside] = await service.summarize(['/proc/1', '/outside']);

      expect(proc).toMatchObject({ path: '/proc/1', state: 'blocked', files: 0 });
      expect(outside).toMatchObject({ path: '/outside', state: 'blocked', files: 0 });
    });

    it('reports folders the batch had no time left for as pending, never as empty, and does not cache them', async () => {
      const unsorted = join(root, 'books', 'Unsorted');
      const cookbooks = join(root, 'books', 'Ebooks', 'Cookbooks');
      await service.summarize([cookbooks]);

      const [late, cached] = await service.summarize([unsorted, cookbooks], -1);
      expect(late).toMatchObject({ path: unsorted, state: 'pending', files: 0 });
      expect(cached).toMatchObject({ path: cookbooks, state: 'ok', files: 2 });

      await expect(service.summarize([unsorted])).resolves.toMatchObject([{ state: 'ok', files: 3 }]);
    });

    it('refuses a symlink into a blocked system path without walking it', async () => {
      await symlink('/dev', join(root, 'dev-link'));

      await expect(service.summarize([join(root, 'dev-link')])).resolves.toMatchObject([{ path: join(root, 'dev-link'), state: 'blocked' }]);
    });

    it('does not keep a failed answer: a folder that appears later is counted', async () => {
      const later = join(root, 'books', 'Later');
      await expect(service.summarize([later])).resolves.toMatchObject([{ state: 'missing' }]);

      await files(later, ['Later.epub']);

      await expect(service.summarize([later])).resolves.toMatchObject([{ state: 'ok', files: 1 }]);
    });

    it('answers a repeat from the cache, and walks again once forgotten', async () => {
      const unsorted = join(root, 'books', 'Unsorted');
      await service.summarize([unsorted]);
      await writeFile(join(unsorted, 'd.epub'), 'x');

      await expect(service.summarize([unsorted])).resolves.toMatchObject([{ files: 3 }]);
      service.forget();
      await expect(service.summarize([unsorted])).resolves.toMatchObject([{ files: 4 }]);
    });
  });

  describe('inspect', () => {
    it('adds the size and the first two book files', async () => {
      await expect(service.inspect(join(root, 'books', 'Ebooks', 'Science Fiction'))).resolves.toMatchObject({
        files: 3,
        bytes: 12,
        samples: ['Ann Leckie/Ancillary Justice (2013)/Ancillary Justice.epub', 'Ann Leckie/Provenance (2017)/Provenance.epub'],
      });
    });

    it('does not walk a blocked path', async () => {
      pathPolicy.resolveBrowsePath.mockResolvedValue('/proc');

      await expect(service.inspect('/proc')).resolves.toMatchObject({ state: 'blocked', bytes: 0, samples: [] });
    });
  });

  describe('unclaimed', () => {
    it('lists library-shaped folders no library reads, biggest first, skipping the data folder', async () => {
      const result = await service.unclaimed();

      expect(result.truncated).toBe(false);
      expect(result.folders.map((folder) => [folder.path.slice(root.length), folder.files])).toEqual([
        ['/books/Ebooks/Science Fiction', 3],
        ['/books/Unsorted', 3],
        ['/books/Ebooks/Cookbooks', 2],
      ]);
    });

    it('looks around the libraries’ folders when nothing is mounted separately', async () => {
      pathService.getPlaces.mockResolvedValue({ root, mounts: [], appDataPath: join(root, 'data'), libraries: [] });

      const result = await service.unclaimed();

      expect(result.folders.map((folder) => folder.path.slice(root.length))).toEqual(['/books/Ebooks/Science Fiction', '/books/Ebooks/Cookbooks']);
    });

    it('shares one scan between pickers asking at the same time', async () => {
      const [first, second] = await Promise.all([service.unclaimed(), service.unclaimed()]);

      expect(first).toBe(second);
      expect(pathService.getPlaces).toHaveBeenCalledTimes(1);
    });

    it('scans again once a library reads a different set of folders', async () => {
      await service.unclaimed();
      pathRepository.findLibraryFolders.mockResolvedValue([
        { libraryId: 1, name: 'Novels', icon: null, type: 'books', path: join(root, 'books', 'Ebooks', 'Fiction') },
        { libraryId: 2, name: 'Inbox', icon: null, type: 'books', path: join(root, 'books', 'Unsorted') },
      ]);

      const result = await service.unclaimed();

      expect(pathService.getPlaces).toHaveBeenCalledTimes(2);
      expect(result.folders.map((folder) => folder.path.slice(root.length))).not.toContain('/books/Unsorted');
    });

    it('does not keep a scan that was running when the cache was cleared', async () => {
      let release!: () => void;
      const places = await pathService.getPlaces();
      pathService.getPlaces.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve(places))));
      const running = service.unclaimed();
      await vi.waitFor(() => expect(release).toBeTypeOf('function'));

      service.forget();
      release();
      await running;
      await service.unclaimed();

      expect(pathService.getPlaces).toHaveBeenCalledTimes(3);
    });

    it('caches the scan until forgotten', async () => {
      await service.unclaimed();
      await service.unclaimed();
      expect(pathService.getPlaces).toHaveBeenCalledTimes(1);

      service.forget();
      await service.unclaimed();
      expect(pathService.getPlaces).toHaveBeenCalledTimes(2);
    });
  });
});
