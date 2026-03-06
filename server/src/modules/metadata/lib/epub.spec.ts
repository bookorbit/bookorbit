jest.mock('unzipper', () => ({ Open: { file: jest.fn() } }));
jest.mock('./opf-parser', () => ({ parseOpf: jest.fn() }));

import * as unzipper from 'unzipper';

import { parseOpf } from './opf-parser';
import { extractEpubMetadata } from './epub';

const mockOpenFile = (unzipper as any).Open.file as jest.Mock;
const mockParseOpf = parseOpf as jest.MockedFunction<typeof parseOpf>;

function zipFile(path: string, content: string | Buffer) {
  const buf = typeof content === 'string' ? Buffer.from(content) : content;
  return {
    path,
    buffer: async () => buf,
  };
}

describe('extractEpubMetadata', () => {
  beforeEach(() => jest.resetAllMocks());

  it('extracts OPF path from container.xml and parses metadata', async () => {
    const containerXml = `
      <container>
        <rootfiles>
          <rootfile full-path="OPS/content.opf" />
        </rootfiles>
      </container>
    `;

    mockOpenFile.mockResolvedValue({
      files: [zipFile('META-INF/container.xml', containerXml), zipFile('OPS/content.opf', '<package/>')],
    });

    mockParseOpf.mockReturnValue({ title: 'Dune', subtitle: null, description: null, isbn10: null, isbn13: null, publisher: null, publishedYear: null, language: null, seriesName: null, seriesIndex: null, authors: [], tags: [] });

    await expect(extractEpubMetadata('/books/dune.epub')).resolves.toEqual(expect.objectContaining({ title: 'Dune' }));
  });

  it('handles container OPF path with leading slash', async () => {
    const containerXml = `<container><rootfiles><rootfile full-path="/OPS/content.opf" /></rootfiles></container>`;

    mockOpenFile.mockResolvedValue({
      files: [zipFile('META-INF/container.xml', containerXml), zipFile('OPS/content.opf', '<package/>')],
    });

    mockParseOpf.mockReturnValue({ title: 'Leading Slash', subtitle: null, description: null, isbn10: null, isbn13: null, publisher: null, publishedYear: null, language: null, seriesName: null, seriesIndex: null, authors: [], tags: [] });

    await expect(extractEpubMetadata('/books/x.epub')).resolves.toEqual(expect.objectContaining({ title: 'Leading Slash' }));
  });

  it('returns null when EPUB internals are missing or invalid', async () => {
    mockOpenFile.mockResolvedValue({ files: [] });

    await expect(extractEpubMetadata('/broken.epub')).resolves.toBeNull();
  });
});
