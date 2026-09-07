import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import * as unzipper from 'unzipper';
import { replaceFileAtomically } from '../shared/atomic-file-replace';
import { writeZipArchive, type ZipRewriteEntry } from '../shared/zip-rewrite';

const ZIP_END_OF_CENTRAL_DIRECTORY_SIZE_BYTES = 22;
const MAX_ZIP_COMMENT_SIZE_BYTES = 0xffff;
const ZIP_TAIL_SIZE_BYTES = ZIP_END_OF_CENTRAL_DIRECTORY_SIZE_BYTES + MAX_ZIP_COMMENT_SIZE_BYTES;

type ZipCentralDirectory = unzipper.CentralDirectory & { comment?: string };

const openZipFileWithOptions = unzipper.Open.file as (filePath: string, options: { tailSize: number }) => Promise<ZipCentralDirectory>;

async function openZipFile(filePath: string): Promise<ZipCentralDirectory> {
  try {
    return await unzipper.Open.file(filePath);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'FILE_ENDED') throw error;
    return openZipFileWithOptions(filePath, { tailSize: ZIP_TAIL_SIZE_BYTES });
  }
}

function isComicInfoEntry(entryPath: string): boolean {
  const normalized = entryPath.replace(/\\/g, '/').toLowerCase();
  return normalized === 'comicinfo.xml' || normalized.endsWith('/comicinfo.xml');
}

export async function readComicInfoFromZip(filePath: string): Promise<string | null> {
  const zip = await openZipFile(filePath);
  const entry = zip.files.find((f) => isComicInfoEntry(f.path));
  if (!entry) return null;
  return (await entry.buffer()).toString('utf-8');
}

export async function writeComicInfoToZip(filePath: string, xmlContent: string): Promise<void> {
  const zip = await openZipFile(filePath);
  const existing = zip.files.find((f) => isComicInfoEntry(f.path));
  const xmlEntryPath = existing?.path ?? 'ComicInfo.xml';

  const tmpPath = join(dirname(filePath), `.cbx-write-${randomUUID()}`);
  await writeZipArchive(tmpPath, rewriteEntries(zip.files, xmlEntryPath, xmlContent), { comment: zip.comment });

  await replaceFileAtomically(tmpPath, filePath);
}

function* rewriteEntries(files: readonly unzipper.File[], xmlEntryPath: string, xmlContent: string): Generator<ZipRewriteEntry> {
  for (const entry of files) {
    if (isComicInfoEntry(entry.path)) continue;
    yield { name: entry.path, source: () => entry.stream() };
  }

  yield { name: xmlEntryPath, source: Buffer.from(xmlContent, 'utf-8') };
}
