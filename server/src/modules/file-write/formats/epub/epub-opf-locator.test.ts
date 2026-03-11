import * as unzipper from 'unzipper';
import type { MockedFunction } from 'vitest';

import { locateOpf } from './epub-opf-locator';

vi.mock('unzipper', () => ({
  Open: {
    file: vi.fn(),
  },
}));

const mockOpenFile = unzipper.Open.file as MockedFunction<typeof unzipper.Open.file>;

describe('locateOpf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns OPF path and directory from container.xml', async () => {
    mockOpenFile.mockResolvedValue({
      files: [
        {
          path: 'META-INF/container.xml',
          buffer: vi
            .fn()
            .mockResolvedValue(
              Buffer.from(`<?xml version="1.0"?><container><rootfiles><rootfile full-path="OPS/content.opf"/></rootfiles></container>`),
            ),
        },
      ],
    } as never);

    await expect(locateOpf('/book.epub')).resolves.toEqual({ opfPath: 'OPS/content.opf', opfDir: 'OPS/' });
  });

  it('throws when container.xml is missing', async () => {
    mockOpenFile.mockResolvedValue({ files: [] } as never);

    await expect(locateOpf('/book.epub')).rejects.toThrow('Missing META-INF/container.xml');
  });

  it('throws when container has no rootfile full-path', async () => {
    mockOpenFile.mockResolvedValue({
      files: [
        {
          path: 'META-INF/container.xml',
          buffer: vi.fn().mockResolvedValue(Buffer.from('<container><rootfiles><rootfile/></rootfiles></container>')),
        },
      ],
    } as never);

    await expect(locateOpf('/book.epub')).rejects.toThrow('Cannot locate OPF path in container.xml');
  });
});
