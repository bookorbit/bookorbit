jest.mock('unzipper', () => ({ Open: { file: jest.fn() } }));

import * as unzipper from 'unzipper';

import { extractEpubCover } from './cover-epub';

const mockOpenFile = (unzipper as any).Open.file as jest.Mock;

function zipFile(path: string, content: string | Buffer) {
  const buf = typeof content === 'string' ? Buffer.from(content) : content;
  return {
    path,
    buffer: async () => buf,
  };
}

describe('extractEpubCover', () => {
  beforeEach(() => jest.resetAllMocks());

  it('extracts cover via EPUB3 cover-image manifest property', async () => {
    const containerXml = `<container><rootfiles><rootfile full-path="OPS/content.opf" /></rootfiles></container>`;
    const opfXml = `
      <package>
        <manifest>
          <item id="cover" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image" />
        </manifest>
      </package>
    `;
    const cover = Buffer.from([1, 2, 3]);

    mockOpenFile.mockResolvedValue({
      files: [
        zipFile('META-INF/container.xml', containerXml),
        zipFile('OPS/content.opf', opfXml),
        zipFile('OPS/images/cover.jpg', cover),
      ],
    });

    await expect(extractEpubCover('/book.epub')).resolves.toEqual(cover);
  });

  it('extracts cover from html cover page referenced by EPUB2 meta cover id', async () => {
    const containerXml = `<container><rootfiles><rootfile full-path="OPS/content.opf" /></rootfiles></container>`;
    const opfXml = `
      <package>
        <metadata><meta name="cover" content="coverpage" /></metadata>
        <manifest>
          <item id="coverpage" href="text/cover.xhtml" media-type="application/xhtml+xml" />
        </manifest>
      </package>
    `;
    const html = `<html><body><img src="../images/c1.png" /></body></html>`;
    const cover = Buffer.from([8, 9, 10]);

    mockOpenFile.mockResolvedValue({
      files: [
        zipFile('META-INF/container.xml', containerXml),
        zipFile('OPS/content.opf', opfXml),
        zipFile('OPS/text/cover.xhtml', html),
        zipFile('OPS/images/c1.png', cover),
      ],
    });

    await expect(extractEpubCover('/book.epub')).resolves.toEqual(cover);
  });

  it('returns null when no cover candidate exists', async () => {
    mockOpenFile.mockResolvedValue({ files: [] });

    await expect(extractEpubCover('/book.epub')).resolves.toBeNull();
  });
});
