import { execFile } from 'child_process';
import { mkdtemp, readFile, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// pdftoppm runs against untrusted library files during scanning, so bound both its
// runtime and its output rather than letting a malformed PDF stall a scan worker.
const PDFTOPPM_OUTPUT_MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const PDFTOPPM_TIMEOUT_MS = 60_000;

// pdftoppm writes the rendered page to disk, not stdout, so maxBuffer does not bound it.
// A PDF declaring very large page dimensions still renders a huge JPEG at 150 DPI, so the
// file is checked before it is read into memory.
const PDFTOPPM_COVER_MAX_BYTES = 10 * 1024 * 1024;

export async function extractPdfCover(absolutePath: string): Promise<Buffer | null> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'pdf-cover-'));
  const outPrefix = join(tmpDir, 'cover');

  try {
    await execFileAsync('pdftoppm', ['-jpeg', '-singlefile', '-r', '150', '-f', '1', '-l', '1', absolutePath, outPrefix], {
      maxBuffer: PDFTOPPM_OUTPUT_MAX_BUFFER_BYTES,
      timeout: PDFTOPPM_TIMEOUT_MS,
    });

    const coverPath = `${outPrefix}.jpg`;
    const { size } = await stat(coverPath);
    if (size > PDFTOPPM_COVER_MAX_BYTES) return null;

    return await readFile(coverPath);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
