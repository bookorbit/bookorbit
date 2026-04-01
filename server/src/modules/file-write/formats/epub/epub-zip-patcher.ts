import { createWriteStream } from 'fs';
import * as unzipper from 'unzipper';
import archiver from 'archiver';
import { replaceFileAtomically } from '../shared/atomic-file-replace';

export async function readEntry(filePath: string, entryPath: string): Promise<string> {
  const zip = await unzipper.Open.file(filePath);
  const entry = zip.files.find((f) => f.path === entryPath);
  if (!entry) throw new Error(`Entry not found in EPUB: ${entryPath}`);
  return (await entry.buffer()).toString('utf-8');
}

export async function patch(filePath: string, patches: Map<string, Buffer>): Promise<void> {
  const tmpPath = filePath + '.tmp';
  const zip = await unzipper.Open.file(filePath);
  const archive = archiver('zip', { zlib: { level: 6 } });
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
      archive.append(patched ?? entry.stream(), { name: entry.path });
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
