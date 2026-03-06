import * as unzipper from 'unzipper';

import { locateOpf } from './epub-opf-locator';

jest.mock('unzipper', () => ({
  Open: {
    file: jest.fn(),
  },
}));

const mockOpenFile = unzipper.Open.file as jest.MockedFunction<typeof unzipper.Open.file>;

describe('locateOpf', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns OPF path and directory from container.xml', async () => {
    mockOpenFile.mockResolvedValue({
      files: [
        {
          path: 'META-INF/container.xml',
          buffer: jest.fn().mockResolvedValue(
            Buffer.from(
              `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OPS/content.opf"/></rootfiles></container>`,
            ),
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
          buffer: jest.fn().mockResolvedValue(Buffer.from('<container><rootfiles><rootfile/></rootfiles></container>')),
        },
      ],
    } as never);

    await expect(locateOpf('/book.epub')).rejects.toThrow('Cannot locate OPF path in container.xml');
  });
});
