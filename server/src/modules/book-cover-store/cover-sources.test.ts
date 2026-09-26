import { hasAudioFiles, selectEmbeddedCoverSources, selectFolderImages } from './cover-sources';

let nextId = 1;
function file(absolutePath: string, overrides: { role?: string; mediaOverlayAvailable?: boolean; sizeBytes?: number } = {}) {
  return {
    id: nextId++,
    absolutePath,
    format: absolutePath.split('.').pop()!,
    role: overrides.role ?? 'content',
    sizeBytes: overrides.sizeBytes ?? 100,
    mediaOverlayAvailable: overrides.mediaOverlayAvailable ?? false,
  };
}

describe('selectEmbeddedCoverSources', () => {
  it('takes the first ebook by library priority and the first audio track by natural name order', () => {
    const files = [file('/b/book.pdf'), file('/b/book.kepub'), file('/b/Part 10.mp3'), file('/b/Part 2.mp3'), file('/b/Part 1.mp3')];

    const sources = selectEmbeddedCoverSources(files, ['kepub', 'pdf', 'mp3']);

    expect(sources.ebook?.absolutePath).toBe('/b/book.kepub');
    expect(sources.audio?.absolutePath).toBe('/b/Part 1.mp3');
  });

  it('gives a read-along EPUB no audio source, because its art is the book cover', () => {
    const sources = selectEmbeddedCoverSources([file('/b/book.epub', { mediaOverlayAvailable: true })], ['epub']);

    expect(sources.ebook?.absolutePath).toBe('/b/book.epub');
    expect(sources.audio).toBeNull();
  });

  it('ignores folder images, sidecars and supplements', () => {
    const sources = selectEmbeddedCoverSources(
      [file('/b/cover.jpg', { role: 'cover' }), file('/b/metadata.opf', { role: 'metadata' }), file('/b/notes.pdf', { role: 'supplement' })],
      ['pdf'],
    );

    expect(sources).toEqual({ ebook: null, audio: null });
  });
});

describe('folder images', () => {
  it('lists cover-role images in natural name order', () => {
    const images = selectFolderImages([file('/b/folder.jpg', { role: 'cover' }), file('/b/book.epub'), file('/b/cover.png', { role: 'cover' })]);

    expect(images.map((image) => image.absolutePath)).toEqual(['/b/cover.png', '/b/folder.jpg']);
  });

  it('tells real audio tracks apart from read-along audio', () => {
    expect(hasAudioFiles([file('/b/book.epub', { mediaOverlayAvailable: true })])).toBe(false);
    expect(hasAudioFiles([file('/b/book.m4b')])).toBe(true);
  });
});
