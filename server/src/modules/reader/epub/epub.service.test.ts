vi.mock('fs/promises', () => ({ stat: vi.fn() }));
vi.mock('unzipper', () => ({ Open: { file: vi.fn() } }));

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { stat } from 'fs/promises';
import { Readable } from 'stream';
import * as unzipper from 'unzipper';

import { EpubService } from './epub.service';

const mockStat = stat as MockedFunction<typeof stat>;
const mockOpenFile = (unzipper as any).Open.file as vi.Mock;

interface ZipEntrySpec {
  path: string;
  content: string | Buffer;
  uncompressedSize?: number;
  streamContent?: string | Buffer;
  bufferError?: Error;
}

function zipEntry(spec: ZipEntrySpec) {
  const content = typeof spec.content === 'string' ? Buffer.from(spec.content) : spec.content;
  const streamContent = typeof spec.streamContent === 'string' ? Buffer.from(spec.streamContent) : (spec.streamContent ?? content);
  return {
    path: spec.path,
    uncompressedSize: spec.uncompressedSize ?? content.length,
    buffer: spec.bufferError ? vi.fn().mockRejectedValue(spec.bufferError) : vi.fn().mockResolvedValue(content),
    stream: vi.fn(() => Readable.from(streamContent)),
  };
}

function makeArchive(entries: ZipEntrySpec[]) {
  return { files: entries.map(zipEntry) };
}

async function readStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

const CONTAINER_XML = `
<container>
  <rootfiles>
    <rootfile full-path="OPS/content.opf" />
  </rootfiles>
</container>
`;

const OPF_XML = `
<package version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Reader Test</dc:title>
    <dc:creator>Jane Doe</dc:creator>
    <dc:language>en</dc:language>
    <dc:publisher>Acme</dc:publisher>
    <dc:description>A sample EPUB</dc:description>
    <dc:identifier>book-1</dc:identifier>
    <meta name="cover" content="cover-image" />
  </metadata>
  <manifest>
    <item id="chap1" href="text/ch1.xhtml" media-type="application/xhtml+xml" />
    <item id="chap2" href="text/ch2.xhtml" media-type="application/xhtml+xml" />
    <item id="style" href="styles/main.css" media-type="text/css" />
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />
    <item id="cover-image" href="images/cover.jpg" media-type="image/jpeg" />
  </manifest>
  <spine>
    <itemref idref="chap1" />
    <itemref idref="chap2" linear="no" />
  </spine>
</package>
`;

const NAV_XHTML = `
<html xmlns:epub="http://www.idpf.org/2007/ops">
  <body>
    <nav epub:type="toc">
      <ol>
        <li><a href="text/ch1.xhtml">Chapter 1</a></li>
        <li>
          <a href="text/ch2.xhtml#part">Chapter 2</a>
          <ol>
            <li><a href="../text/ch3.xhtml">Chapter 3</a></li>
          </ol>
        </li>
      </ol>
    </nav>
  </body>
</html>
`;

const NCX_XML = `
<ncx>
  <navMap>
    <navPoint>
      <navLabel><text>NCX Chapter</text></navLabel>
      <content src="text/ch1.xhtml" />
      <navPoint>
        <navLabel><text>NCX Child</text></navLabel>
        <content src="text/ch2.xhtml#frag" />
      </navPoint>
    </navPoint>
  </navMap>
</ncx>
`;

const NAV_EDGE_XHTML = `
<html xmlns:epub="http://www.idpf.org/2007/ops">
  <body>
    <nav epub:type="toc">
      <ol>
        <li><a>Plain Label</a></li>
        <li><a href="http://example.com/book">External Link</a></li>
        <li><a href="text/ch1.xhtml"><span id="num">7</span></a></li>
        <li><a><span /></a></li>
      </ol>
    </nav>
  </body>
</html>
`;

function makeEpubArchive(options?: { navBufferError?: boolean; omitChapterFile?: boolean; lowerCasePaths?: boolean }) {
  const lower = options?.lowerCasePaths === true;
  const ops = lower ? 'ops' : 'OPS';
  const navSpec: ZipEntrySpec = options?.navBufferError
    ? { path: `${ops}/nav.xhtml`, content: NAV_XHTML, bufferError: new Error('bad nav') }
    : { path: `${ops}/nav.xhtml`, content: NAV_XHTML };

  return makeArchive([
    { path: 'META-INF/container.xml', content: CONTAINER_XML },
    { path: `${ops}/content.opf`, content: OPF_XML },
    navSpec,
    { path: `${ops}/toc.ncx`, content: NCX_XML },
    ...(options?.omitChapterFile
      ? []
      : [{ path: `${ops}/text/ch1.xhtml`, content: '<h1>ch1</h1>', streamContent: 'chapter-one', uncompressedSize: 11 }]),
    { path: `${ops}/text/ch2.xhtml`, content: '<h1>ch2</h1>' },
    { path: `${ops}/styles/main.css`, content: 'body {}' },
    { path: `${ops}/images/cover.jpg`, content: Buffer.from([0xff, 0xd8, 0xff]) },
    { path: 'META-INF/encryption.xml', content: '<enc />', streamContent: '<enc />' },
  ]);
}

describe('EpubService', () => {
  const user = { id: 10, isSuperuser: false, permissions: [] } as any;
  const bookReadService = {
    findLibraryIdByBookId: vi.fn(),
    findFileById: vi.fn(),
    findPrimaryFilesByBookIds: vi.fn(),
  };
  const libraryService = {
    verifyUserAccess: vi.fn(),
  };
  let service: EpubService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new EpubService(bookReadService as any, libraryService as any);
    bookReadService.findLibraryIdByBookId.mockResolvedValue(3);
    bookReadService.findPrimaryFilesByBookIds.mockResolvedValue([{ format: 'epub', absolutePath: '/books/book.epub', sizeBytes: null }]);
    libraryService.verifyUserAccess.mockResolvedValue(undefined);
    mockStat.mockResolvedValue({ mtimeMs: 100 } as Awaited<ReturnType<typeof stat>>);
  });

  it('parses EPUB metadata, spine, TOC, and optional META-INF files', async () => {
    mockOpenFile.mockResolvedValueOnce(makeEpubArchive({ lowerCasePaths: true }) as any);

    const info = await service.getBookInfo(99, undefined, user);

    expect(info.containerPath).toBe('OPS/content.opf');
    expect(info.rootPath).toBe('OPS/');
    expect(info.coverPath).toBe('OPS/images/cover.jpg');
    expect(info.optionalFiles).toContain('META-INF/encryption.xml');
    expect(info.metadata).toEqual(
      expect.objectContaining({
        title: 'Reader Test',
        creator: 'Jane Doe',
        language: 'en',
        publisher: 'Acme',
        description: 'A sample EPUB',
        identifier: 'book-1',
      }),
    );
    expect(info.spine).toEqual([
      { idref: 'chap1', href: 'OPS/text/ch1.xhtml', mediaType: 'application/xhtml+xml', linear: true },
      { idref: 'chap2', href: 'OPS/text/ch2.xhtml', mediaType: 'application/xhtml+xml', linear: false },
    ]);
    expect(info.toc).toEqual(
      expect.objectContaining({
        label: 'Table of Contents',
        children: [
          { label: 'Chapter 1', href: 'OPS/text/ch1.xhtml', children: undefined },
          {
            label: 'Chapter 2',
            href: 'OPS/text/ch2.xhtml#part',
            children: [{ label: 'Chapter 3', href: 'text/ch3.xhtml', children: undefined }],
          },
        ],
      }),
    );
    expect(libraryService.verifyUserAccess).toHaveBeenCalledWith(10, 3, false);
  });

  it('falls back to NCX TOC when nav parsing fails', async () => {
    mockOpenFile.mockResolvedValueOnce(makeEpubArchive({ navBufferError: true }) as any);

    const info = await service.getBookInfo(99, undefined, user);

    expect(info.toc).toEqual(
      expect.objectContaining({
        label: 'Table of Contents',
        children: [
          {
            label: 'NCX Chapter',
            href: 'OPS/text/ch1.xhtml',
            children: [{ label: 'NCX Child', href: 'OPS/text/ch2.xhtml#frag', children: undefined }],
          },
        ],
      }),
    );
  });

  it('handles nav/text edge cases and malformed percent-encoded href values', async () => {
    const opfWithMalformedHref = OPF_XML.replace('href="styles/main.css"', 'href="styles/%E0%A4%A.css"');
    mockOpenFile.mockResolvedValueOnce(
      makeArchive([
        { path: 'META-INF/container.xml', content: CONTAINER_XML },
        { path: 'OPS/content.opf', content: opfWithMalformedHref },
        { path: 'OPS/nav.xhtml', content: NAV_EDGE_XHTML },
        { path: 'OPS/toc.ncx', content: NCX_XML },
        { path: 'OPS/text/ch1.xhtml', content: '<h1>ch1</h1>' },
      ]) as any,
    );

    const info = await service.getBookInfo(99, undefined, user);

    expect(info.toc?.children).toEqual([
      { label: 'Plain Label', href: undefined, children: undefined },
      { label: 'External Link', href: 'http://example.com/book', children: undefined },
      { label: '7', href: 'OPS/text/ch1.xhtml', children: undefined },
    ]);
    expect(info.manifest.some((item) => item.href === 'OPS/styles/%E0%A4%A.css')).toBe(true);
  });

  it('rejects stream requests with invalid paths', async () => {
    await expect(service.streamFile(1, '../OPS/text/ch1.xhtml', undefined, user)).rejects.toThrow(ForbiddenException);
    await expect(service.streamFile(1, '/', undefined, user)).rejects.toThrow(ForbiddenException);
  });

  it('streams manifest entries with manifest media type and size', async () => {
    mockOpenFile.mockResolvedValueOnce(makeEpubArchive() as any).mockResolvedValueOnce(makeEpubArchive() as any);

    const result = await service.streamFile(1, 'OPS/text/ch1.xhtml', undefined, user);

    expect(result.contentType).toBe('application/xhtml+xml');
    expect(result.size).toBe(11);
    await expect(readStream(result.stream)).resolves.toEqual(Buffer.from('chapter-one'));
  });

  it('streams optional META-INF files using guessed content type', async () => {
    mockOpenFile.mockResolvedValueOnce(makeEpubArchive() as any).mockResolvedValueOnce(makeEpubArchive() as any);

    const result = await service.streamFile(1, 'META-INF/encryption.xml', undefined, user);

    expect(result.contentType).toBe('application/xml');
    await expect(readStream(result.stream)).resolves.toEqual(Buffer.from('<enc />'));
  });

  it('throws when requested path is outside parsed manifest/optional files', async () => {
    mockOpenFile.mockResolvedValueOnce(makeEpubArchive() as any);

    await expect(service.streamFile(1, 'OPS/text/missing.xhtml', undefined, user)).rejects.toThrow(NotFoundException);
    expect(mockOpenFile).toHaveBeenCalledTimes(1);
  });

  it('throws when parsed path exists but archive entry cannot be found at stream time', async () => {
    mockOpenFile.mockResolvedValueOnce(makeEpubArchive() as any).mockResolvedValueOnce(makeEpubArchive({ omitChapterFile: true }) as any);

    await expect(service.streamFile(1, 'OPS/text/ch1.xhtml', undefined, user)).rejects.toThrow(NotFoundException);
  });

  it('uses cache when mtime is unchanged and reparses after mtime update', async () => {
    const titleOne = OPF_XML.replace('Reader Test', 'Title One');
    const titleTwo = OPF_XML.replace('Reader Test', 'Title Two');
    mockStat
      .mockResolvedValueOnce({ mtimeMs: 200 } as Awaited<ReturnType<typeof stat>>)
      .mockResolvedValueOnce({ mtimeMs: 200 } as Awaited<ReturnType<typeof stat>>);
    mockOpenFile.mockResolvedValueOnce(
      makeArchive([
        { path: 'META-INF/container.xml', content: CONTAINER_XML },
        { path: 'OPS/content.opf', content: titleOne },
        { path: 'OPS/nav.xhtml', content: NAV_XHTML },
        { path: 'OPS/toc.ncx', content: NCX_XML },
      ]) as any,
    );

    const first = await service.getBookInfo(1, undefined, user);
    const second = await service.getBookInfo(1, undefined, user);
    expect(first.metadata['title']).toBe('Title One');
    expect(second.metadata['title']).toBe('Title One');
    expect(mockOpenFile).toHaveBeenCalledTimes(1);

    mockStat.mockResolvedValueOnce({ mtimeMs: 300 } as Awaited<ReturnType<typeof stat>>);
    mockOpenFile.mockResolvedValueOnce(
      makeArchive([
        { path: 'META-INF/container.xml', content: CONTAINER_XML },
        { path: 'OPS/content.opf', content: titleTwo },
        { path: 'OPS/nav.xhtml', content: NAV_XHTML },
        { path: 'OPS/toc.ncx', content: NCX_XML },
      ]) as any,
    );

    const third = await service.getBookInfo(1, undefined, user);
    expect(third.metadata['title']).toBe('Title Two');
    expect(mockOpenFile).toHaveBeenCalledTimes(2);
  });

  it('validates EPUB path resolution for book and file constraints', async () => {
    bookReadService.findLibraryIdByBookId.mockResolvedValueOnce(null);
    await expect(service.getBookInfo(5, undefined, user)).rejects.toThrow(new NotFoundException('Book 5 not found'));

    bookReadService.findLibraryIdByBookId.mockResolvedValue(3);
    bookReadService.findFileById.mockResolvedValueOnce({ bookId: 6, format: 'epub', absolutePath: '/books/other.epub' });
    await expect(service.getBookInfo(5, 77, user)).rejects.toThrow(new NotFoundException('File 77 not found for book 5'));

    bookReadService.findFileById.mockResolvedValueOnce({ bookId: 5, format: 'pdf', absolutePath: '/books/file.pdf' });
    await expect(service.getBookInfo(5, 77, user)).rejects.toThrow(new NotFoundException('File 77 is not an EPUB file'));

    bookReadService.findPrimaryFilesByBookIds.mockResolvedValueOnce([{ format: 'pdf', absolutePath: '/books/file.pdf' }]);
    await expect(service.getBookInfo(5, undefined, user)).rejects.toThrow(new NotFoundException('No primary EPUB file for book 5'));
  });

  it('uses explicit fileId path when valid and skips primary-file lookup', async () => {
    bookReadService.findFileById.mockResolvedValue({ bookId: 5, format: 'epub', absolutePath: '/books/alt.epub', fileHash: 'hash1', sizeBytes: 123 });
    mockOpenFile.mockResolvedValueOnce(makeEpubArchive() as any);

    await service.getBookInfo(5, 88, user);

    expect(bookReadService.findFileById).toHaveBeenCalledWith(88);
    expect(bookReadService.findPrimaryFilesByBookIds).not.toHaveBeenCalled();
  });

  it('always serves the original EPUB regardless of Kobo settings', async () => {
    bookReadService.findFileById.mockResolvedValue({ bookId: 5, format: 'epub', absolutePath: '/books/alt.epub', fileHash: 'hash1', sizeBytes: 123 });
    mockOpenFile.mockResolvedValueOnce(makeEpubArchive() as any);

    await service.getBookInfo(5, 88, user);

    expect(mockStat).toHaveBeenCalledWith('/books/alt.epub');
    expect(mockOpenFile).toHaveBeenCalledWith('/books/alt.epub');
  });

  it('evicts oldest cache entry when capacity is reached', () => {
    const cache = (service as any).cache as Map<string, any>;
    for (let i = 0; i < 50; i += 1) {
      cache.set(`book-${i}`, {
        info: {} as any,
        mtime: i,
        validPaths: new Set<string>(),
        lastAccessed: i,
      });
    }

    (service as any).evict();

    expect(cache.size).toBe(49);
    expect(cache.has('book-0')).toBe(false);
  });
});
