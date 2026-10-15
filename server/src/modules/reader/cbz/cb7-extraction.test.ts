import { compareComicPagePaths, listExtractedFiles, removeExtractedTree } from './cb7-extraction';
import { FakeSevenZip } from './test-helpers';

/** The order CB7 pages had when the archive was extracted flat: file names alone, naturally sorted. */
function flatOrder(names: string[]): string[] {
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

describe('compareComicPagePaths', () => {
  it('keeps the flat order for an archive with no folders', () => {
    const names = ['10.jpg', '2.jpg', '1.jpg', 'cover.png', 'Page 3.jpg', 'page 20.jpg'];

    expect([...names].sort(compareComicPagePaths)).toEqual(flatOrder(names));
  });

  it.each([
    [['vol2/003.jpg', 'vol1/001.jpg', 'vol10/002.jpg']],
    [['b/c10.jpg', 'a/c9.jpg', 'c/c1.jpg', 'Z.jpg', 'a/b.jpg']],
    [['scans/credits.png', 'chapter 1/p001.jpg', 'chapter 2/p002.jpg', 'chapter 10/p003.jpg', 'cover.jpg']],
  ])('orders foldered pages exactly as the flat extraction did when file names are unique: %j', (paths) => {
    const sorted = [...paths].sort(compareComicPagePaths).map(basename);

    expect(sorted).toEqual(flatOrder(paths.map(basename)));
  });

  it('keeps pages that share a file name, ordered by folder', () => {
    const paths = ['ch2/001.jpg', 'ch10/001.jpg', 'ch1/002.jpg', 'ch1/001.jpg', 'ch2/002.jpg'];

    expect([...paths].sort(compareComicPagePaths)).toEqual(['ch1/001.jpg', 'ch2/001.jpg', 'ch10/001.jpg', 'ch1/002.jpg', 'ch2/002.jpg']);
  });
});

describe('listExtractedFiles', () => {
  it('walks folders, including hidden ones, and returns paths relative to the root', () => {
    const sevenZip = new FakeSevenZip();
    sevenZip.addFile('/work/001.jpg', 'a');
    sevenZip.addFile('/work/ch1/001.jpg', 'b');
    sevenZip.addFile('/work/ch1/deep/002.jpg', 'c');
    sevenZip.addFile('/work/.thumbs/t.jpg', 'd');
    sevenZip.addFile('/elsewhere/other.jpg', 'e');

    expect(listExtractedFiles(sevenZip.FS, '/work').sort()).toEqual(['.thumbs/t.jpg', '001.jpg', 'ch1/001.jpg', 'ch1/deep/002.jpg']);
  });

  it('keeps links to files inside the root and drops links that leave it, dangle or name a folder', () => {
    const sevenZip = new FakeSevenZip({
      'ch1/001.jpg': 'page',
      'ch1/same.jpg': { link: '001.jpg' },
      'ch1/up.jpg': { link: '../ch1/001.jpg' },
      'ch1/escape.jpg': { link: '../../secret/page.jpg' },
      'ch1/absolute.jpg': { link: '/secret/page.jpg' },
      'ch1/dangling.jpg': { link: 'missing.jpg' },
      'ch1/folder.jpg': { link: '../ch1' },
    });
    sevenZip.addFile('/secret/page.jpg', 'not yours');
    sevenZip.FS.mkdir('/work');
    sevenZip.callMain(['x', '/archive.7z', '-o/work', '-y']);

    expect(listExtractedFiles(sevenZip.FS, '/work').sort()).toEqual(['ch1/001.jpg', 'ch1/same.jpg', 'ch1/up.jpg']);
  });

  it('returns nothing for a root that does not exist', () => {
    expect(listExtractedFiles(new FakeSevenZip().FS, '/missing')).toEqual([]);
  });
});

describe('removeExtractedTree', () => {
  it('removes a nested tree, links included, and leaves everything else', () => {
    const sevenZip = new FakeSevenZip({ 'a/b/1.jpg': 'x', 'a/2.jpg': 'y', 'link.jpg': { link: 'a/2.jpg' } });
    sevenZip.addFile('/keep/3.jpg', 'z');
    sevenZip.FS.mkdir('/work');
    sevenZip.callMain(['x', '/archive.7z', '-o/work', '-y']);

    removeExtractedTree(sevenZip.FS, '/work');

    expect(sevenZip.paths()).toEqual(['/keep', '/keep/3.jpg']);
  });

  it('ignores a folder that is already gone', () => {
    expect(() => removeExtractedTree(new FakeSevenZip().FS, '/missing')).not.toThrow();
  });
});
