vi.mock('fs/promises', () => ({ open: vi.fn() }));

import { open } from 'fs/promises';
import { detectComicContainerFormat } from './comic-format-detect';

type MockFileHandle = { read: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };

const mockOpen = open as unknown as ReturnType<typeof vi.fn>;

function makeHandle(bytes: number[]): MockFileHandle {
  return {
    read: vi.fn().mockImplementation((buf: Buffer, offset: number, length: number) => {
      const src = Buffer.from(bytes);
      const n = Math.min(length, src.length);
      src.copy(buf, offset, 0, n);
      return Promise.resolve({ bytesRead: n });
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe('detectComicContainerFormat', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns "cb7" immediately without reading the file', async () => {
    await expect(detectComicContainerFormat('/a.cb7', 'cb7')).resolves.toBe('cb7');
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it('detects a ZIP file as "cbz" regardless of stored format', async () => {
    mockOpen.mockResolvedValue(makeHandle([0x50, 0x4b, 0x03, 0x04]));
    await expect(detectComicContainerFormat('/a.cbr', 'cbr')).resolves.toBe('cbz');
  });

  it('detects a RAR 4 file as "cbr" regardless of stored format', async () => {
    mockOpen.mockResolvedValue(makeHandle([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]));
    await expect(detectComicContainerFormat('/a.cbz', 'cbz')).resolves.toBe('cbr');
  });

  it('detects a RAR 5 file as "cbr" regardless of stored format', async () => {
    mockOpen.mockResolvedValue(makeHandle([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]));
    await expect(detectComicContainerFormat('/a.cbz', 'cbz')).resolves.toBe('cbr');
  });

  it('does not classify a Rar! prefix without the full RAR signature as "cbr"', async () => {
    mockOpen.mockResolvedValue(makeHandle([0x52, 0x61, 0x72, 0x21, 0x00, 0x00, 0x00, 0x00]));
    await expect(detectComicContainerFormat('/a.cbz', 'cbz')).resolves.toBe('cbz');
  });

  it('returns stored format when bytes match neither ZIP nor RAR', async () => {
    mockOpen.mockResolvedValue(makeHandle([0x00, 0x01, 0x02, 0x03]));
    await expect(detectComicContainerFormat('/a.cbz', 'cbz')).resolves.toBe('cbz');
  });

  it('returns stored format when file is shorter than 4 bytes', async () => {
    mockOpen.mockResolvedValue(makeHandle([0x50, 0x4b]));
    await expect(detectComicContainerFormat('/tiny.cbr', 'cbr')).resolves.toBe('cbr');
  });

  it('returns stored format when file is shorter than 4 bytes', async () => {
    mockOpen.mockResolvedValue(makeHandle([0x52]));
    await expect(detectComicContainerFormat('/a.cbz', 'cbz')).resolves.toBe('cbz');
  });

  it('returns stored format on ENOENT (file not found)', async () => {
    mockOpen.mockRejectedValue(Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' }));
    await expect(detectComicContainerFormat('/missing.cbz', 'cbz')).resolves.toBe('cbz');
  });

  it('returns stored format when open throws any other I/O error', async () => {
    mockOpen.mockRejectedValue(new Error('EACCES: permission denied'));
    await expect(detectComicContainerFormat('/locked.cbr', 'cbr')).resolves.toBe('cbr');
  });

  it('closes the file handle even when read throws', async () => {
    const handle = { read: vi.fn().mockRejectedValue(new Error('read error')), close: vi.fn().mockResolvedValue(undefined) };
    mockOpen.mockResolvedValue(handle);
    await expect(detectComicContainerFormat('/bad.cbz', 'cbz')).resolves.toBe('cbz');
    expect(handle.close).toHaveBeenCalled();
  });

  it('closes the file handle after a successful read', async () => {
    const handle = makeHandle([0x50, 0x4b, 0x03, 0x04]);
    mockOpen.mockResolvedValue(handle);
    await detectComicContainerFormat('/good.cbz', 'cbz');
    expect(handle.close).toHaveBeenCalled();
  });

  it('identifies ZIP even when storedFmt is cbz (no false override)', async () => {
    mockOpen.mockResolvedValue(makeHandle([0x50, 0x4b, 0x03, 0x04]));
    await expect(detectComicContainerFormat('/a.cbz', 'cbz')).resolves.toBe('cbz');
  });
});
