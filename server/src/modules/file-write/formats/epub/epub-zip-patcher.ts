import { createWriteStream } from 'fs';
import type { Readable } from 'stream';
import * as unzipper from 'unzipper';
import { ZipArchive, type Archiver } from 'archiver';
import { replaceFileAtomically } from '../shared/atomic-file-replace';

export async function readEntry(filePath: string, entryPath: string): Promise<string> {
  const zip = await unzipper.Open.file(filePath);
  const entry = zip.files.find((f) => f.path === entryPath);
  if (!entry) throw new Error(`Entry not found in EPUB: ${entryPath}`);
  return (await entry.buffer()).toString('utf-8');
}

export async function listEntryPaths(filePath: string): Promise<string[]> {
  const zip = await unzipper.Open.file(filePath);
  return zip.files.map((entry) => entry.path);
}

export async function patch(filePath: string, patches: Map<string, Buffer>): Promise<void> {
  const tmpPath = filePath + '.tmp';
  const zip = await unzipper.Open.file(filePath);
  const archive = new ZipArchive({ zlib: { level: 6 } });
  const output = createWriteStream(tmpPath);

  await new Promise<void>((resolve, reject) => {
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);

    archive.append(Buffer.from('application/epub+zip'), { name: 'mimetype', store: true });

    for (const entry of zip.files) {
      if (entry.path === 'mimetype') continue;
      const patched = patches.get(entry.path);
      if (patched) {
        archive.append(patched, { name: entry.path });
      } else {
        appendEntryStream(archive, entry, reject);
      }
    }

    for (const [path, content] of patches) {
      if (!zip.files.some((e) => e.path === path)) {
        archive.append(content, { name: path });
      }
    }

    void archive.finalize();
  });

  await replaceFileAtomically(tmpPath, filePath);
}

function appendEntryStream(archive: Archiver, entry: { path: string; stream: () => Readable }, reject: (error: Error) => void): void {
  const source = entry.stream();
  source.once('error', reject);
  archive.append(source, { name: entry.path });
}
