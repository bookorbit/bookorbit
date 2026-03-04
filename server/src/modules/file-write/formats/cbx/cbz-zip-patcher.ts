import * as fs from 'fs/promises';
import { createWriteStream } from 'fs';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import * as unzipper from 'unzipper';
import archiver from 'archiver';

function isComicInfoEntry(entryPath: string): boolean {
  const normalized = entryPath.replace(/\\/g, '/').toLowerCase();
  return normalized === 'comicinfo.xml' || normalized.endsWith('/comicinfo.xml');
}

export async function readComicInfoFromZip(filePath: string): Promise<string | null> {
  const zip = await unzipper.Open.file(filePath);
  const entry = zip.files.find((f) => isComicInfoEntry(f.path));
  if (!entry) return null;
  return (await entry.buffer()).toString('utf-8');
}

export async function writeComicInfoToZip(filePath: string, xmlContent: string): Promise<void> {
  const zip = await unzipper.Open.file(filePath);
  const existing = zip.files.find((f) => isComicInfoEntry(f.path));
  const xmlEntryPath = existing?.path ?? 'ComicInfo.xml';

  const tmpPath = join(dirname(filePath), `.cbx-write-${randomUUID()}`);
  const archive = archiver('zip', { zlib: { level: 6 } });
  const output = createWriteStream(tmpPath);

  await new Promise<void>((resolve, reject) => {
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);

    for (const entry of zip.files) {
      if (isComicInfoEntry(entry.path)) continue;
      archive.append(entry.stream(), { name: entry.path });
    }

    archive.append(Buffer.from(xmlContent, 'utf-8'), { name: xmlEntryPath });
    void archive.finalize();
  });

  try {
    await fs.rename(tmpPath, filePath);
  } catch (err) {
    await fs.unlink(tmpPath).catch(() => {});
    throw err;
  }
}
