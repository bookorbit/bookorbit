import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { lookup } from 'dns/promises';

import { AuthorImageStorageService } from './author-image-storage.service';

vi.mock('../metadata/lib/cover', () => ({
  generateThumbnail: vi.fn(() => Promise.resolve(Buffer.from('thumbnail-bytes'))),
  imageExt: vi.fn(() => 'jpg'),
}));

vi.mock('dns/promises', () => ({
  lookup: vi.fn(),
}));

describe('AuthorImageStorageService', () => {
  let booksPath: string;
  let service: AuthorImageStorageService;

  beforeEach(async () => {
    vi.resetAllMocks();
    booksPath = await mkdtemp(join(tmpdir(), 'authors-image-storage-'));
    service = new AuthorImageStorageService({
      get: vi.fn().mockReturnValue(booksPath),
    } as never);
  });

  afterEach(async () => {
    await rm(booksPath, { recursive: true, force: true });
  });

  it('rejects localhost URLs before fetch', async () => {
    global.fetch = vi.fn();

    await expect(service.saveFromUrl(1, 'http://localhost/image.jpg')).resolves.toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects URLs that resolve to private IPs', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as never);
    global.fetch = vi.fn();

    await expect(service.saveFromUrl(1, 'https://example.test/image.jpg')).resolves.toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects direct private IP URLs', async () => {
    global.fetch = vi.fn();

    await expect(service.saveFromUrl(1, 'http://10.0.0.4/image.jpg')).resolves.toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('saves image and thumbnail for public hosts and removes old photo files', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: vi.fn().mockReturnValue('image/jpeg') },
      body: (async function* () {
        await Promise.resolve();
        yield Buffer.from('image-bytes');
      })(),
    } as never);

    const authorDir = join(booksPath, 'authors', '42');
    await mkdir(authorDir, { recursive: true });
    await writeFile(join(authorDir, 'photo.png'), Buffer.from('old-photo'));

    await expect(service.saveFromUrl(42, 'https://cdn.example.com/author.jpg')).resolves.toBe(true);

    await expect(readFile(join(authorDir, 'photo.jpg'))).resolves.toEqual(Buffer.from('image-bytes'));
    await expect(readFile(join(authorDir, 'thumbnail.jpg'))).resolves.toEqual(Buffer.from('thumbnail-bytes'));
    await expect(readFile(join(authorDir, 'photo.png'))).rejects.toThrow();
  });
});
