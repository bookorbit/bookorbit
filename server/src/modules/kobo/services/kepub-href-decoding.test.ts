import { execFile } from 'child_process';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { ZipArchive } from 'archiver';
import * as unzipper from 'unzipper';

import { findDecodableHrefs, restoreEncodedHrefs, writeWithDecodedHrefs } from './kepub-href-decoding';
import { KepubifyBinaryService } from './kepubify-binary.service';

const execFileAsync = promisify(execFile);

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

// Hrefs are URLs, so files stored with spaces, `&` or `#` in their names are listed percent-encoded.
const CONTENT_OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Encoded hrefs</dc:title><dc:identifier id="uid">x</dc:identifier><dc:language>en</dc:language></metadata>
  <manifest>
    <item id="spaces" href="text/chapter%20one.xhtml" media-type="application/xhtml+xml"/>
    <item id="amp" href="text/notes%20%26%20more.xhtml" media-type="application/xhtml+xml"/>
    <item id="hash" href="text/part%231.xhtml" media-type="application/xhtml+xml"/>
    <item id="literal" href="text/stored%20as%20written.xhtml" media-type="application/xhtml+xml"/>
    <item id="plain" href="text/plain.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="spaces"/><itemref idref="amp"/><itemref idref="hash"/><itemref idref="literal"/><itemref idref="plain"/></spine>
  <guide><reference type="text" title="Start" href="text/chapter%20one.xhtml#start"/></guide>
</package>`;

function chapter(text: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head>
<body><p id="start">${text} The first sentence of the chapter.</p><p>A second paragraph follows it.</p></body></html>`;
}

const ENTRIES: [string, string][] = [
  ['OEBPS/text/chapter one.xhtml', chapter('Spaces.')],
  ['OEBPS/text/notes & more.xhtml', chapter('Ampersand.')],
  ['OEBPS/text/part#1.xhtml', chapter('Hash.')],
  // Stored with the escapes in its name, so the href already resolves as written.
  ['OEBPS/text/stored%20as%20written.xhtml', chapter('Literal.')],
  ['OEBPS/text/plain.xhtml', chapter('Plain.')],
];

async function buildEpub(path: string): Promise<void> {
  const archive = new ZipArchive({ zlib: { level: 6 } });
  const chunks: Buffer[] = [];
  archive.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<void>((resolve, reject) => {
    archive.on('end', resolve);
    archive.on('error', reject);
  });
  archive.append('application/epub+zip', { name: 'mimetype', store: true });
  archive.append(CONTAINER_XML, { name: 'META-INF/container.xml' });
  archive.append(CONTENT_OPF, { name: 'OEBPS/content.opf' });
  for (const [name, body] of ENTRIES) archive.append(body, { name });
  await archive.finalize();
  await done;
  await writeFile(path, Buffer.concat(chunks));
}

async function readEntries(path: string): Promise<Map<string, string>> {
  const zip = await unzipper.Open.file(path);
  const entries = new Map<string, string>();
  for (const file of zip.files) if (file.type === 'File') entries.set(file.path, (await file.buffer()).toString('utf8'));
  return entries;
}

function hrefAttributes(opf: string): string[] {
  return [...opf.matchAll(/\bhref="([^"]*)"/g)].map((match) => match[1]!);
}

function hasSpans(xhtml: string | undefined): boolean {
  return (xhtml ?? '').includes('koboSpan');
}

describe('kepub href decoding (real kepubify)', () => {
  let dir: string;
  let epubPath: string;
  let kepubify: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bookorbit-kepub-hrefs-'));
    epubPath = join(dir, 'book.epub');
    await buildEpub(epubPath);
    kepubify = await new KepubifyBinaryService().getBinaryPath();
  }, 60_000);

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('finds the hrefs that resolve only once decoded, keyed by the stored name', async () => {
    const decoded = await findDecodableHrefs(epubPath);

    expect(Object.fromEntries(decoded)).toEqual({
      'text/chapter one.xhtml': 'text/chapter%20one.xhtml',
      'text/chapter one.xhtml#start': 'text/chapter%20one.xhtml#start',
      'text/notes & more.xhtml': 'text/notes%20%26%20more.xhtml',
      'text/part#1.xhtml': 'text/part%231.xhtml',
    });
  });

  it('documents why: kepubify leaves a chapter listed by its encoded href unconverted', async () => {
    const out = join(dir, 'as-is.kepub.epub');
    await execFileAsync(kepubify, ['--output', out, epubPath], { timeout: 60_000 });
    const entries = await readEntries(out);

    expect(hasSpans(entries.get('OEBPS/text/chapter one.xhtml'))).toBe(false);
    expect(hasSpans(entries.get('OEBPS/text/plain.xhtml'))).toBe(true);
  }, 60_000);

  it('converts every chapter and hands back the package with the book’s own hrefs', async () => {
    const decoded = await findDecodableHrefs(epubPath);
    const source = join(dir, 'decoded.epub');
    const converted = join(dir, 'converted.kepub.epub');
    const restoredPath = join(dir, 'restored.kepub.epub');

    await writeWithDecodedHrefs(epubPath, source, decoded);
    const decodedOpf = (await readEntries(source)).get('OEBPS/content.opf')!;
    expect(decodedOpf).toContain('href="text/notes &amp; more.xhtml"');
    expect(decodedOpf).toContain('href="text/stored%20as%20written.xhtml"');

    await execFileAsync(kepubify, ['--output', converted, source], { timeout: 60_000 });
    const restored = await restoreEncodedHrefs(converted, restoredPath, decoded);
    const entries = await readEntries(restoredPath);

    expect(restored).toBe(4);
    for (const name of ['OEBPS/text/chapter one.xhtml', 'OEBPS/text/notes & more.xhtml', 'OEBPS/text/part#1.xhtml', 'OEBPS/text/plain.xhtml']) {
      expect(hasSpans(entries.get(name)), name).toBe(true);
    }
    // kepubify adds a title page of its own once it can read the first chapter; every other href is the book's.
    const hrefs = hrefAttributes(entries.get('OEBPS/content.opf')!);
    expect(hrefs.filter((href) => !href.startsWith('kepubify-'))).toEqual(hrefAttributes(CONTENT_OPF));
    const first = (await unzipper.Open.file(restoredPath)).files[0]!;
    expect(first.path).toBe('mimetype');
    expect(first.compressionMethod).toBe(0);
  }, 60_000);

  it('rejects input that is not an archive, so the caller falls back to converting it as is', async () => {
    const notAnEpub = join(dir, 'not-an.epub');
    await writeFile(notAnEpub, 'plain text');

    await expect(findDecodableHrefs(notAnEpub)).rejects.toThrow();
  });
});
