import { ZipArchive } from 'archiver';
import { execFile as execFileCallback } from 'child_process';
import { createWriteStream } from 'fs';
import { chmod, copyFile, link, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';

import { PDFDocument } from 'pdf-lib';

import type { BookWritePayloadKey } from '../interfaces/book-write-payload.interface';
import type { FormatWriter } from '../interfaces/format-writer.interface';
import { Mp3AudioFormatWriter } from './audio/audio-format-writer';
import { AudioMetadataEmbedder } from './audio/audio-metadata-embedder';
import { CbzFormatWriter } from './cbx/cbz-format-writer';
import { EpubFormatWriter } from './epub/epub-format-writer';
import { Fb2FormatWriter } from './fb2/fb2-format-writer';
import { MobiEbookFormatWriter } from './mobi/mobi-format-writer';
import { buildMobiFixture } from './mobi/mobi-test-fixtures';
import { PdfFormatWriter } from './pdf/pdf-format-writer';

const execFile = promisify(execFileCallback);
const requireInstaller = createRequire(__filename);

/**
 * A keep-original Library Dock hardlinks a seeding download into the library (D34). Writing
 * metadata into the library copy must split it from the download rather than edit the shared
 * bytes, or the torrent would stop verifying. Every writer saves a temp file and swaps it in;
 * this checks that end to end, one format at a time. CB7 goes through the same swap and is
 * covered by the shared atomic-replace test.
 */
describe('a metadata write on a hardlinked library file', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'bookorbit-hardlinked-write-'));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  async function expectSeedingCopyUntouched(extension: string, original: Buffer, writer: FormatWriter, fields: BookWritePayloadKey[]) {
    const seeding = join(root, 'downloads', `seeding.${extension}`);
    const library = join(root, 'library', `book.${extension}`);
    await mkdir(join(root, 'downloads'), { recursive: true });
    await mkdir(join(root, 'library'), { recursive: true });
    await writeFile(seeding, original);
    await link(seeding, library);
    expect((await stat(seeding)).nlink).toBe(2);

    const result = await writer.write(library, { title: 'Written By BookOrbit' }, { fieldMask: new Set(fields), dryRun: false });

    expect(result.status).toBe('success');
    expect(await readFile(seeding)).toEqual(original);
    expect((await stat(seeding)).nlink).toBe(1);
    expect(await readFile(library)).not.toEqual(original);
  }

  it('leaves the seeding FB2 byte-identical', async () => {
    const fb2 = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">',
      '<description><title-info><book-title>Old Title</book-title><lang>en</lang></title-info></description>',
      '<body><section><p>Text.</p></section></body>',
      '</FictionBook>',
    ].join('\n');
    await expectSeedingCopyUntouched('fb2', Buffer.from(fb2), new Fb2FormatWriter(), ['title']);
  });

  it('leaves the seeding EPUB byte-identical', async () => {
    const opf = `<package version="3.0" unique-identifier="uid" xmlns="http://www.idpf.org/2007/opf">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:identifier id="uid">urn:test:seeding</dc:identifier><dc:title>Old title</dc:title><dc:language>en</dc:language>
      </metadata>
      <manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml" /></manifest>
      <spine><itemref idref="chapter" /></spine>
    </package>`;
    const container = `<?xml version="1.0" encoding="UTF-8"?>
      <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
        <rootfiles><rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml" /></rootfiles>
      </container>`;
    const epub = await zip([
      { name: 'mimetype', content: 'application/epub+zip', store: true },
      { name: 'META-INF/container.xml', content: container },
      { name: 'OPS/content.opf', content: opf },
      { name: 'OPS/chapter.xhtml', content: '<html><body>chapter</body></html>' },
    ]);
    await expectSeedingCopyUntouched('epub', epub, new EpubFormatWriter(), ['title']);
  });

  it('leaves the seeding MOBI byte-identical', async () => {
    await expectSeedingCopyUntouched('mobi', buildMobiFixture(), new MobiEbookFormatWriter(), ['title']);
  });

  it('leaves the seeding PDF byte-identical', async () => {
    const document = await PDFDocument.create();
    document.addPage();
    document.setTitle('Old Title');
    await expectSeedingCopyUntouched('pdf', Buffer.from(await document.save()), new PdfFormatWriter(), ['title']);
  });

  it('leaves the seeding CBZ byte-identical', async () => {
    const cbz = await zip([{ name: 'page-001.jpg', content: Buffer.alloc(64, 7) }]);
    await expectSeedingCopyUntouched('cbz', cbz, new CbzFormatWriter(), ['title']);
  });

  it('leaves the seeding MP3 byte-identical', async () => {
    const ffmpegPath = (requireInstaller('@ffmpeg-installer/ffmpeg') as { path: string }).path;
    const ffprobePath = join(root, 'ffprobe');
    await copyFile((requireInstaller('@ffprobe-installer/ffprobe') as { path: string }).path, ffprobePath);
    await chmod(ffprobePath, 0o755);
    vi.stubEnv('FFMPEG_PATH', ffmpegPath);
    vi.stubEnv('FFPROBE_PATH', ffprobePath);
    const fixture = join(root, 'fixture.mp3');
    await execFile(ffmpegPath, [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=1000:duration=0.2',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '64k',
      fixture,
    ]);

    const writer = new Mp3AudioFormatWriter(new AudioMetadataEmbedder({ ffmpegPath, ffprobePath, scanReader: 'ffprobe' }));
    await expectSeedingCopyUntouched('mp3', await readFile(fixture), writer, ['title']);
  });

  async function zip(entries: Array<{ name: string; content: string | Buffer; store?: boolean }>): Promise<Buffer> {
    const path = join(root, `fixture-${entries.length}-${Date.now()}.zip`);
    const output = createWriteStream(path);
    const archive = new ZipArchive({ zlib: { level: 6 } });
    await new Promise<void>((resolve, reject) => {
      output.on('close', resolve);
      output.on('error', reject);
      archive.on('error', reject);
      archive.pipe(output);
      for (const entry of entries) archive.append(Buffer.from(entry.content), { name: entry.name, store: entry.store });
      void archive.finalize();
    });
    return readFile(path);
  }
});
