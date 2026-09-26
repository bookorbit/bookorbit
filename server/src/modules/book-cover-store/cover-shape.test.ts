import { assignFolderImages, classifyCoverShape, type FolderImageCandidate } from './cover-shape';

function image(name: string, width: number, height: number): FolderImageCandidate {
  return { path: `/book/${name}`, name, width, height };
}

const bothMedia = { bothMedia: true, squareOnlyAudio: false, primaryMedium: 'ebook' as const };

describe('classifyCoverShape', () => {
  it.each([
    [500, 500, 'square'],
    [475, 500, 'square'],
    [550, 500, 'square'],
    [400, 600, 'portrait'],
    [425, 500, 'portrait'],
    // Portrait jackets padded to near-square, as Goodreads serves some, are not audiobook art.
    [400, 430, 'ambiguous'],
    [430, 500, 'ambiguous'],
    [800, 500, 'ambiguous'],
    [null, 500, 'ambiguous'],
  ] as const)('%s x %s is %s', (width, height, shape) => {
    expect(classifyCoverShape(width, height)).toBe(shape);
  });
});

describe('assignFolderImages', () => {
  it('gives a single-medium book its best-fitting image whatever the shape', () => {
    const result = assignFolderImages([image('cover.jpg', 400, 600), image('folder.jpg', 500, 520)], ['audio'], {
      ...bothMedia,
      bothMedia: false,
    });

    expect(result.get('audio')?.name).toBe('folder.jpg');
  });

  it('sends square art to the audio slot and portrait art to the ebook slot', () => {
    const result = assignFolderImages([image('cover.jpg', 400, 600), image('folder.jpg', 500, 500)], ['ebook', 'audio'], bothMedia);

    expect(result.get('ebook')?.name).toBe('cover.jpg');
    expect(result.get('audio')?.name).toBe('folder.jpg');
  });

  it('never crosses shapes on a book with both media', () => {
    expect(assignFolderImages([image('cover.jpg', 400, 600)], ['audio'], bothMedia).size).toBe(0);
    expect(assignFolderImages([image('cover.jpg', 500, 500)], ['ebook'], bothMedia).size).toBe(0);
  });

  it('gives an ambiguous image to the empty slot of the primary medium first', () => {
    const landscape = [image('cover.jpg', 800, 500)];

    expect([...assignFolderImages(landscape, ['ebook', 'audio'], bothMedia).keys()]).toEqual(['ebook']);
    expect([...assignFolderImages(landscape, ['ebook', 'audio'], { ...bothMedia, primaryMedium: 'audio' }).keys()]).toEqual(['audio']);
  });

  it('keeps ambiguous art out of the audio slot of a read-along EPUB', () => {
    const result = assignFolderImages([image('cover.jpg', 800, 500)], ['audio'], { ...bothMedia, squareOnlyAudio: true });

    expect(result.size).toBe(0);
  });

  it('prefers the closest fit, then basename order, and never uses one image twice', () => {
    const result = assignFolderImages(
      [image('folder.jpg', 500, 500), image('cover.jpg', 500, 500), image('front.jpg', 520, 500), image('extra.jpg', 800, 500)],
      ['ebook', 'audio'],
      bothMedia,
    );

    expect(result.get('audio')?.name).toBe('cover.jpg');
    expect(result.get('ebook')?.name).toBe('extra.jpg');
  });
});
