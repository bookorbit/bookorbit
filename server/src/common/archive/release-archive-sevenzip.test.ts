import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import { createSevenZipTempId, getSevenZip } from '../sevenzip';
import { extractReleaseArchive } from './release-archive';

/**
 * The 7z path plans against sizes read from the expanded tree rather than against its contents,
 * which is a claim about a real WASM filesystem. The rest of the 7z coverage stands on a fake one,
 * so this is the test that would catch the fake and the real module disagreeing.
 */
describe('extractReleaseArchive against the real 7z module', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'bookorbit-7z-real-'));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  /** Built by the same module that reads it, because nothing else here can produce a 7z. */
  async function buildSevenZip(files: Record<string, string>): Promise<string> {
    const sevenZip = await getSevenZip();
    const root = `/${createSevenZipTempId('build')}`;
    sevenZip.FS.mkdir(root);
    for (const [name, contents] of Object.entries(files)) {
      const segments = name.split('/');
      for (let depth = 1; depth < segments.length; depth++) {
        try {
          sevenZip.FS.mkdir(`${root}/${segments.slice(0, depth).join('/')}`);
        } catch {
          // already there
        }
      }
      const fd = sevenZip.FS.open(`${root}/${name}`, 'w+');
      const bytes = new TextEncoder().encode(contents);
      sevenZip.FS.write(fd, bytes, 0, bytes.length);
      sevenZip.FS.close(fd);
    }

    sevenZip.callMain(['a', `${root}/release.7z`, `${root}/*`, '-y']);
    const archive = join(workspace, 'release.7z');
    await writeFile(archive, sevenZip.FS.readFile(`${root}/release.7z`));
    return archive;
  }

  it('expands a real archive, folders and all', async () => {
    const archive = await buildSevenZip({ 'Dune.epub': 'book bytes', 'art/cover.jpg': 'image bytes' });
    const target = join(workspace, 'out');

    await extractReleaseArchive(archive, '7z', target);

    expect(await readFile(join(target, 'Dune.epub'), 'utf8')).toBe('book bytes');
    expect(await readFile(join(target, 'art', 'cover.jpg'), 'utf8')).toBe('image bytes');
  });
});
