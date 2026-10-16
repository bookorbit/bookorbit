import { mkdtemp, rm, utimes, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import { createSevenZipTempId, getSevenZip } from '../../../common/sevenzip';
import { CbzService, type ComicPageResult } from './cbz.service';

/**
 * CB7 page listing walks a tree the real 7-Zip wrote, so these cases run against the real WASM
 * module: the unit tests stand on a fake filesystem, and this is where the two would disagree.
 */
describe('CbzService CB7 pages against the real 7z module', () => {
  const user = { id: 9, isSuperuser: false, permissions: [] } as any;
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'bookorbit-cb7-real-'));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  async function buildSevenZip(files: Record<string, string>): Promise<Uint8Array> {
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
    sevenZip.callMain(['a', `${root}/comic.7z`, `${root}/*`, '-y']);
    return sevenZip.FS.readFile(`${root}/comic.7z`);
  }

  /** The page list the flat `e` extraction produced before folders were kept. */
  async function flatPageNames(archive: Uint8Array): Promise<string[]> {
    const sevenZip = await getSevenZip();
    const root = `/${createSevenZipTempId('flat')}`;
    sevenZip.FS.mkdir(root);
    const fd = sevenZip.FS.open(`${root}.7z`, 'w+');
    sevenZip.FS.write(fd, archive, 0, archive.length);
    sevenZip.FS.close(fd);
    sevenZip.callMain(['e', `${root}.7z`, `-o${root}`, '-y']);
    return sevenZip.FS.readdir(root)
      .filter((name) => name !== '.' && name !== '..' && /\.(jpe?g|png)$/i.test(name) && !name.startsWith('.'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  }

  async function pageTexts(service: CbzService, fileId: number): Promise<string[]> {
    const count = await service.getPageCount(fileId, user);
    const texts: string[] = [];
    for (let index = 0; index < count; index++) {
      const result: ComicPageResult = await service.streamPage(fileId, index, user);
      if (result.notModified) throw new Error('expected page bytes');
      const chunks: Buffer[] = [];
      for await (const chunk of result.stream) chunks.push(Buffer.from(chunk));
      texts.push(Buffer.concat(chunks).toString());
    }
    return texts;
  }

  it('keeps the flat page order for an archive whose page names are unique', async () => {
    const files = {
      'Chapter 10/c10.jpg': 'c10.jpg',
      'Chapter 2/c2.jpg': 'c2.jpg',
      'cover.jpg': 'cover.jpg',
      'extras/.thumbs/z1.jpg': 'z1.jpg',
      'extras/credits.png': 'credits.png',
      'extras/._credits.png': 'hidden',
    };
    const archive = await buildSevenZip(files);
    const path = join(workspace, 'unique.cb7');
    await writeFile(path, archive);
    const service = new CbzService({ verifyFileAccess: vi.fn().mockResolvedValue({ format: 'cb7', absolutePath: path }) } as any);

    await expect(pageTexts(service, 31)).resolves.toEqual(await flatPageNames(archive));
  });

  it('serves pages that share a name in different folders, and rereads a rewritten file', async () => {
    const path = join(workspace, 'nested.cb7');
    await writeFile(path, await buildSevenZip({ 'ch2/001.jpg': 'ch2-1', 'ch1/001.jpg': 'ch1-1', 'ch1/002.jpg': 'ch1-2' }));
    const service = new CbzService({ verifyFileAccess: vi.fn().mockResolvedValue({ format: 'cb7', absolutePath: path }) } as any);

    await expect(pageTexts(service, 32)).resolves.toEqual(['ch1-1', 'ch2-1', 'ch1-2']);

    await writeFile(path, await buildSevenZip({ 'ch1/001.jpg': 'rewritten' }));
    await utimes(path, new Date(), new Date(Date.now() + 60_000));

    await expect(pageTexts(service, 32)).resolves.toEqual(['rewritten']);
  });
});
