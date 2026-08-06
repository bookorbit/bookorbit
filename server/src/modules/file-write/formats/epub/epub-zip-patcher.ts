import * as unzipper from 'unzipper';
import { replaceFileAtomically } from '../shared/atomic-file-replace';
import { writeZipArchive, type ZipRewriteEntry } from '../shared/zip-rewrite';

const MIMETYPE_ENTRY_PATH = 'mimetype';

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

  await writeZipArchive(tmpPath, rewriteEntries(zip.files, patches));

  await replaceFileAtomically(tmpPath, filePath);
}

function* rewriteEntries(files: readonly unzipper.File[], patches: Map<string, Buffer>): Generator<ZipRewriteEntry> {
  yield { name: MIMETYPE_ENTRY_PATH, source: Buffer.from('application/epub+zip'), store: true };

  for (const entry of files) {
    if (entry.path === MIMETYPE_ENTRY_PATH) continue;
    const patched = patches.get(entry.path);
    yield { name: entry.path, source: patched ?? (() => entry.stream()) };
  }

  for (const [path, content] of patches) {
    if (!files.some((entry) => entry.path === path)) {
      yield { name: path, source: content };
    }
  }
}
