vi.mock('unzipper', () => ({ Open: { file: vi.fn() } }));
vi.mock('./opf-parser', () => ({ parseOpf: vi.fn() }));

import * as unzipper from 'unzipper';

import { parseOpf } from './opf-parser';
import { extractEpubMetadata } from './epub';

const mockOpenFile = (unzipper as any).Open.file as vi.Mock;
const mockParseOpf = parseOpf as MockedFunction<typeof parseOpf>;

function zipFile(path: string, content: string | Buffer) {
  const buf = typeof content === 'string' ? Buffer.from(content) : content;
  return {
    path,
    buffer: () => Promise.resolve(buf),
  };
}

describe('extractEpubMetadata', () => {
  beforeEach(() => vi.resetAllMocks());

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

    mockParseOpf.mockReturnValue({
      title: 'Dune',
      subtitle: null,
      description: null,
      isbn10: null,
      isbn13: null,
      publisher: null,
      publishedYear: null,
      language: null,
      seriesName: null,
      seriesIndex: null,
      authors: [],
      tags: [],
    });

    await expect(extractEpubMetadata('/books/dune.epub')).resolves.toEqual(expect.objectContaining({ title: 'Dune' }));
  });

  it('handles container OPF path with leading slash', async () => {
    const containerXml = `<container><rootfiles><rootfile full-path="/OPS/content.opf" /></rootfiles></container>`;

    mockOpenFile.mockResolvedValue({
      files: [zipFile('META-INF/container.xml', containerXml), zipFile('OPS/content.opf', '<package/>')],
    });

    mockParseOpf.mockReturnValue({
      title: 'Leading Slash',
      subtitle: null,
      description: null,
      isbn10: null,
      isbn13: null,
      publisher: null,
      publishedYear: null,
      language: null,
      seriesName: null,
      seriesIndex: null,
      authors: [],
      tags: [],
    });

    await expect(extractEpubMetadata('/books/x.epub')).resolves.toEqual(expect.objectContaining({ title: 'Leading Slash' }));
  });

  it('returns null when EPUB internals are missing or invalid', async () => {
    mockOpenFile.mockResolvedValue({ files: [] });

    await expect(extractEpubMetadata('/broken.epub')).resolves.toBeNull();
  });

  it('fills the ISBN from a content scan when the OPF has none', async () => {
    const containerXml = `<container><rootfiles><rootfile full-path="content.opf" /></rootfiles></container>`;
    const opfXml = `<package xmlns="http://www.idpf.org/2007/opf"><manifest><item id="c" href="copyright.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c"/></spine></package>`;

    mockOpenFile.mockResolvedValue({
      files: [
        zipFile('META-INF/container.xml', containerXml),
        zipFile('content.opf', opfXml),
        zipFile('copyright.xhtml', '<html><body><p>ISBN: 978-0-306-40615-7</p></body></html>'),
      ],
    });

    mockParseOpf.mockReturnValue({
      title: 'No Metadata ISBN',
      subtitle: null,
      description: null,
      isbn10: null,
      isbn13: null,
      publisher: null,
      publishedYear: null,
      language: null,
      seriesName: null,
      seriesIndex: null,
      authors: [],
      tags: [],
    });

    await expect(extractEpubMetadata('/books/x.epub')).resolves.toEqual(expect.objectContaining({ isbn10: null, isbn13: '9780306406157' }));
  });

  it('keeps the OPF ISBN and does not override it from content', async () => {
    const containerXml = `<container><rootfiles><rootfile full-path="content.opf" /></rootfiles></container>`;
    const opfXml = `<package xmlns="http://www.idpf.org/2007/opf"><manifest><item id="c" href="copyright.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c"/></spine></package>`;

    mockOpenFile.mockResolvedValue({
      files: [
        zipFile('META-INF/container.xml', containerXml),
        zipFile('content.opf', opfXml),
        zipFile('copyright.xhtml', '<html><body><p>ISBN: 978-1-63576-626-4</p></body></html>'),
      ],
    });

    mockParseOpf.mockReturnValue({
      title: 'Has Metadata ISBN',
      subtitle: null,
      description: null,
      isbn10: '0306406152',
      isbn13: null,
      publisher: null,
      publishedYear: null,
      language: null,
      seriesName: null,
      seriesIndex: null,
      authors: [],
      tags: [],
    });

    await expect(extractEpubMetadata('/books/y.epub')).resolves.toEqual(expect.objectContaining({ isbn10: '0306406152', isbn13: null }));
  });
});
