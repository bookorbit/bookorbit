import { execFile } from 'child_process';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// pdftoppm runs against untrusted library files during scanning, so bound both its
// runtime and its output rather than letting a malformed PDF stall a scan worker.
const PDFTOPPM_OUTPUT_MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const PDFTOPPM_TIMEOUT_MS = 60_000;

export async function extractPdfCover(absolutePath: string): Promise<Buffer | null> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'pdf-cover-'));
  const outPrefix = join(tmpDir, 'cover');

  try {
    await execFileAsync('pdftoppm', ['-jpeg', '-singlefile', '-r', '150', '-f', '1', '-l', '1', absolutePath, outPrefix], {
      maxBuffer: PDFTOPPM_OUTPUT_MAX_BUFFER_BYTES,
      timeout: PDFTOPPM_TIMEOUT_MS,
    });
    return await readFile(`${outPrefix}.jpg`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
