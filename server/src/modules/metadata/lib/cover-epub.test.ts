vi.mock('unzipper', () => ({ Open: { file: vi.fn() } }));

import * as unzipper from 'unzipper';

import { extractEpubAudioCover, extractEpubCover } from './cover-epub';

const mockOpenFile = (unzipper as any).Open.file as vi.Mock;

function zipFile(path: string, content: string | Buffer) {
  const buf = typeof content === 'string' ? Buffer.from(content) : content;
  return {
    path,
    buffer: () => Promise.resolve(buf),
  };
}

describe('extractEpubCover', () => {
  beforeEach(() => vi.resetAllMocks());

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
      files: [zipFile('META-INF/container.xml', containerXml), zipFile('OPS/content.opf', opfXml), zipFile('OPS/images/cover.jpg', cover)],
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

describe('audio cover property', () => {
  const containerXml = `<container><rootfiles><rootfile full-path="OPS/content.opf" /></rootfiles></container>`;
  const portrait = Buffer.from([1, 2, 3]);
  const square = Buffer.from([4, 5, 6]);
  const AUDIO_ITEM =
    '<item id="audio-cover-image" href="images/audio-cover.jpg" media-type="image/jpeg" properties="storyteller:audio-cover-image" />';

  function opf(extraItems: string): string {
    return `
      <package>
        <metadata />
        <manifest>
          <item id="cover" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image" />
          ${extraItems}
        </manifest>
      </package>
    `;
  }

  function open(opfXml: string, extra: Array<ReturnType<typeof zipFile>> = []) {
    mockOpenFile.mockResolvedValue({
      files: [
        zipFile('META-INF/container.xml', containerXml),
        zipFile('OPS/content.opf', opfXml),
        zipFile('OPS/images/cover.jpg', portrait),
        zipFile('OPS/images/audio-cover.jpg', square),
        ...extra,
      ],
    });
  }

  beforeEach(() => vi.resetAllMocks());

  it('reads the image that carries the property, and leaves the book cover alone', async () => {
    open(opf(AUDIO_ITEM));

    await expect(extractEpubAudioCover('/book.epub')).resolves.toEqual(square);
    await expect(extractEpubCover('/book.epub')).resolves.toEqual(portrait);
  });

  it('has no audio cover without the property, however the image is named or shaped', async () => {
    open(opf('<item id="audio-cover-image" href="images/audio-cover.jpg" media-type="image/jpeg" />'));

    await expect(extractEpubAudioCover('/book.epub')).resolves.toBeNull();
  });

  it('has no audio cover when the property is on a non-image or unsupported item', async () => {
    open(
      opf(
        '<item id="doc" href="text/a.xhtml" media-type="application/xhtml+xml" properties="storyteller:audio-cover-image" />' +
          '<item id="svg" href="images/a.svg" media-type="image/svg+xml" properties="storyteller:audio-cover-image" />',
      ),
    );

    await expect(extractEpubAudioCover('/book.epub')).resolves.toBeNull();
  });

  it("never reads the book's own cover as the audio cover", async () => {
    open(opf('').replace('properties="cover-image"', 'properties="cover-image storyteller:audio-cover-image"'));

    await expect(extractEpubAudioCover('/book.epub')).resolves.toBeNull();
    await expect(extractEpubCover('/book.epub')).resolves.toEqual(portrait);
  });

  it('refuses an image that inflates past the size bound', async () => {
    mockOpenFile.mockResolvedValue({
      files: [
        zipFile('META-INF/container.xml', containerXml),
        zipFile('OPS/content.opf', opf('<item id="big" href="images/big.jpg" media-type="image/jpeg" properties="storyteller:audio-cover-image" />')),
        { path: 'OPS/images/big.jpg', uncompressedSize: 33 * 1024 * 1024, buffer: () => Promise.reject(new Error('must not inflate')) },
      ],
    });

    await expect(extractEpubAudioCover('/book.epub')).resolves.toBeNull();
  });

  it('never takes the audio cover for the book cover when the book declares none', async () => {
    mockOpenFile.mockResolvedValue({
      files: [
        zipFile('META-INF/container.xml', containerXml),
        zipFile('OPS/content.opf', `<package><metadata /><manifest>${AUDIO_ITEM}</manifest></package>`),
        zipFile('OPS/images/audio-cover.jpg', square),
      ],
    });

    await expect(extractEpubCover('/book.epub')).resolves.toBeNull();
    await expect(extractEpubAudioCover('/book.epub')).resolves.toEqual(square);
  });
});
