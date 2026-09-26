import { ZipArchive } from 'archiver';
import { createWriteStream } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { dirname } from 'path';
import sharp from 'sharp';

export function jpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 40, g: 110, b: 180 } } })
    .jpeg()
    .toBuffer();
}

/** A minimal EPUB 3 whose manifest names a cover image, so the scanner extracts real art from it. */
export async function writeEpubWithCover(path: string, cover: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const opf = `<?xml version="1.0"?><package version="3.0" unique-identifier="uid" xmlns="http://www.idpf.org/2007/opf">
    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:e2e:cover-slots</dc:identifier><dc:title>Cover Slots</dc:title><dc:language>en</dc:language></metadata>
    <manifest><item id="cover" href="cover.jpg" media-type="image/jpeg" properties="cover-image" /><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml" /></manifest>
    <spine><itemref idref="c1" /></spine></package>`;
  const output = createWriteStream(path);
  const archive = new ZipArchive({ zlib: { level: 6 } });
  await new Promise<void>((resolve, reject) => {
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.append(Buffer.from('application/epub+zip'), { name: 'mimetype', store: true });
    archive.append(
      Buffer.from(
        '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml" /></rootfiles></container>',
      ),
      { name: 'META-INF/container.xml' },
    );
    archive.append(Buffer.from(opf), { name: 'OPS/content.opf' });
    archive.append(Buffer.from('<html xmlns="http://www.w3.org/1999/xhtml"><body><p>x</p></body></html>'), { name: 'OPS/c1.xhtml' });
    archive.append(cover, { name: 'OPS/cover.jpg' });
    void archive.finalize();
  });
}

export async function writeImage(path: string, width: number, height: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, await jpeg(width, height));
}
