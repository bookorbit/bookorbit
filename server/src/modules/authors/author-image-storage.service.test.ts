import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { lookup } from 'dns/promises';
import { generateThumbnail, imageExt } from '../metadata/lib/cover';

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

  it('rejects non-http protocols and private IPv6 loopback URLs', async () => {
    global.fetch = vi.fn();

    await expect(service.saveFromUrl(1, 'ftp://example.com/image.jpg')).resolves.toBe(false);
    await expect(service.saveFromUrl(1, 'http://[::1]/image.jpg')).resolves.toBe(false);
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

  it('follows safe redirects and persists image', async () => {
    vi.mocked(lookup)
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }] as never)
      .mockResolvedValueOnce([{ address: '203.0.113.10', family: 4 }] as never);
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        status: 302,
        ok: false,
        headers: { get: vi.fn((name: string) => (name === 'location' ? 'https://img.example.org/author.jpg' : null)) },
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: { get: vi.fn().mockReturnValue('image/jpeg') },
        body: (async function* () {
          await Promise.resolve();
          yield Buffer.from('redirected-image');
        })(),
      } as never);

    await expect(service.saveFromUrl(7, 'https://cdn.example.com/author.jpg')).resolves.toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('blocks redirects to private hosts', async () => {
    vi.mocked(lookup)
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }] as never)
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }] as never);
    global.fetch = vi.fn().mockResolvedValue({
      status: 302,
      ok: false,
      headers: { get: vi.fn((name: string) => (name === 'location' ? 'http://127.0.0.1/blocked.jpg' : null)) },
    } as never);

    await expect(service.saveFromUrl(8, 'https://cdn.example.com/author.jpg')).resolves.toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('throws typed transient error on upstream 429 status', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    global.fetch = vi.fn().mockResolvedValue({
      status: 429,
      ok: false,
      headers: { get: vi.fn((name: string) => (name === 'retry-after' ? '30' : null)) },
    } as never);

    await expect(service.saveFromUrl(99, 'https://cdn.example.com/author.jpg')).rejects.toMatchObject({
      name: 'AuthorImageStorageError',
      transient: true,
      httpStatus: 429,
      retryAfterMs: 30_000,
    });
  });

  it('returns false for empty or invalid URLs', async () => {
    global.fetch = vi.fn();

    await expect(service.saveFromUrl(1, '   ')).resolves.toBe(false);
    await expect(service.saveFromUrl(1, 'not-a-url')).resolves.toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('normalizes protocol-relative URLs to https', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: { get: vi.fn().mockReturnValue('image/jpeg') },
      body: (async function* () {
        await Promise.resolve();
        yield Buffer.from('protocol-relative-image');
      })(),
    } as never);

    await expect(service.saveFromUrl(3, '//cdn.example.com/a.jpg')).resolves.toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('https://cdn.example.com/a.jpg'),
      expect.objectContaining({ redirect: 'manual' }),
    );
  });

  it('returns false for non-image responses, missing bodies, and non-ok statuses', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: { get: vi.fn().mockReturnValue('application/json') },
        body: (async function* () {
          await Promise.resolve();
          yield Buffer.from('{}');
        })(),
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: { get: vi.fn().mockReturnValue('image/jpeg') },
        body: null,
      } as never)
      .mockResolvedValueOnce({
        status: 404,
        ok: false,
        headers: { get: vi.fn().mockReturnValue('image/jpeg') },
      } as never);

    await expect(service.saveFromUrl(10, 'https://cdn.example.com/a.jpg')).resolves.toBe(false);
    await expect(service.saveFromUrl(10, 'https://cdn.example.com/b.jpg')).resolves.toBe(false);
    await expect(service.saveFromUrl(10, 'https://cdn.example.com/c.jpg')).resolves.toBe(false);
  });

  it('returns false when image payload exceeds hard size limit', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: { get: vi.fn().mockReturnValue('image/jpeg') },
      body: (async function* () {
        await Promise.resolve();
        yield Buffer.alloc(11 * 1024 * 1024, 1);
        yield Buffer.alloc(11 * 1024 * 1024, 1);
      })(),
    } as never);

    await expect(service.saveFromUrl(12, 'https://cdn.example.com/large.jpg')).resolves.toBe(false);
  });

  it('returns false on redirects without location', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    global.fetch = vi.fn().mockResolvedValue({
      status: 302,
      ok: false,
      headers: { get: vi.fn().mockReturnValue(null) },
    } as never);

    await expect(service.saveFromUrl(13, 'https://cdn.example.com/redirect.jpg')).resolves.toBe(false);
  });

  it('returns false when redirect location is invalid', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    global.fetch = vi.fn().mockResolvedValue({
      status: 302,
      ok: false,
      headers: { get: vi.fn((name: string) => (name === 'location' ? 'http://%' : null)) },
    } as never);

    await expect(service.saveFromUrl(13, 'https://cdn.example.com/redirect.jpg')).resolves.toBe(false);
  });

  it('throws non-transient error when redirect limit is exceeded', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    global.fetch = vi.fn().mockResolvedValue({
      status: 302,
      ok: false,
      headers: { get: vi.fn((name: string) => (name === 'location' ? 'https://cdn.example.com/again.jpg' : null)) },
    } as never);

    await expect(service.saveFromUrl(14, 'https://cdn.example.com/first.jpg')).rejects.toMatchObject({
      name: 'AuthorImageStorageError',
      transient: false,
      message: 'Too many image redirects',
    });
  });

  it('wraps unexpected fetch failures in typed transient errors', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));

    await expect(service.saveFromUrl(15, 'https://cdn.example.com/image.jpg')).rejects.toMatchObject({
      name: 'AuthorImageStorageError',
      transient: true,
      httpStatus: null,
      retryAfterMs: null,
    });
  });

  it('rejects URL when DNS resolution fails', async () => {
    vi.mocked(lookup).mockRejectedValueOnce(new Error('dns lookup failed'));
    global.fetch = vi.fn();

    await expect(service.saveFromUrl(15, 'https://cdn.example.com/image.jpg')).resolves.toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('parses HTTP-date retry-after values for 5xx failures', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    const retryAt = new Date(Date.now() + 60_000).toUTCString();
    global.fetch = vi.fn().mockResolvedValue({
      status: 503,
      ok: false,
      headers: { get: vi.fn((name: string) => (name === 'retry-after' ? retryAt : null)) },
    } as never);

    await expect(service.saveFromUrl(15, 'https://cdn.example.com/image.jpg')).rejects.toMatchObject({
      name: 'AuthorImageStorageError',
      transient: true,
      httpStatus: 503,
      retryAfterMs: expect.any(Number),
    });
  });

  it('throws typed error when persist pipeline fails after download', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: { get: vi.fn().mockReturnValue('image/jpeg') },
      body: (async function* () {
        await Promise.resolve();
        yield Buffer.from('image');
      })(),
    } as never);
    vi.mocked(imageExt).mockImplementationOnce(() => {
      throw new Error('unrecognized image');
    });

    await expect(service.saveFromUrl(16, 'https://cdn.example.com/image.jpg')).rejects.toMatchObject({
      name: 'AuthorImageStorageError',
      transient: true,
      message: expect.stringContaining('Failed to persist author image'),
    });
    expect(generateThumbnail).not.toHaveBeenCalled();
  });

  it('returns disk paths and cache-busted URLs when files exist', async () => {
    const authorDir = join(booksPath, 'authors', '21');
    await mkdir(authorDir, { recursive: true });
    await writeFile(join(authorDir, 'photo.png'), Buffer.from('img'));
    await writeFile(join(authorDir, 'thumbnail.jpg'), Buffer.from('thumb'));

    const imagePath = await service.getImagePath(21);
    const thumbPath = await service.getThumbnailPath(21);
    const imageUrl = await service.getImageUrlIfExists(21);
    const thumbUrl = await service.getThumbnailUrlIfExists(21);

    expect(imagePath).toBe(join(authorDir, 'photo.png'));
    expect(thumbPath).toBe(join(authorDir, 'thumbnail.jpg'));
    expect(imageUrl).toMatch(/^\/api\/v1\/authors\/21\/image\?t=\d+$/);
    expect(thumbUrl).toMatch(/^\/api\/v1\/authors\/21\/thumbnail\?t=\d+$/);
  });

  it('returns null paths when image files are missing', async () => {
    await expect(service.getImagePath(777)).resolves.toBeNull();
    await expect(service.getThumbnailPath(777)).resolves.toBeNull();
  });

  it('falls back to plain image and thumbnail URLs when stat fails', async () => {
    vi.spyOn(service, 'getImagePath').mockResolvedValue('/tmp/missing-image.jpg');
    vi.spyOn(service, 'getThumbnailPath').mockResolvedValue('/tmp/missing-thumb.jpg');

    await expect(service.getImageUrlIfExists(22)).resolves.toBe('/api/v1/authors/22/image');
    await expect(service.getThumbnailUrlIfExists(22)).resolves.toBe('/api/v1/authors/22/thumbnail');
  });
});
