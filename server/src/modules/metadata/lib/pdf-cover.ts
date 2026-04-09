import { execFile } from 'child_process';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export async function extractPdfCover(absolutePath: string): Promise<Buffer | null> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'pdf-cover-'));
  const outPrefix = join(tmpDir, 'cover');

  try {
    await execFileAsync('pdftoppm', ['-jpeg', '-singlefile', '-r', '150', '-f', '1', '-l', '1', absolutePath, outPrefix]);
    return await readFile(`${outPrefix}.jpg`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
