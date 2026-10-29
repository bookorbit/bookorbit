import { Readable } from 'stream';
import type * as unzipper from 'unzipper';
import { hasMultimediaEntries, inspectDeliveryEpub } from './epub-delivery-validation';

function publication(opfAudioHref: string, smilAudioHref: string, prolog = '', textHref = 'chapter.xhtml#sentence'): unzipper.CentralDirectory {
  const content = new Map([
    ['META-INF/container.xml', '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>'],
    [
      'OPS/book.opf',
      `${prolog}<package><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml" media-overlay="overlay"/><item id="overlay" href="overlay.smil" media-type="application/smil+xml"/><item id="audio" href="${opfAudioHref}" media-type="audio/mpeg"/></manifest><spine><itemref idref="chapter"/></spine></package>`,
    ],
    ['OPS/chapter.xhtml', '<html><body><p id="sentence">Hello</p></body></html>'],
    ['OPS/overlay.smil', `<smil><body><par><text src="${textHref}"/><audio src="${smilAudioHref}"/></par></body></smil>`],
    ['OPS/audio&chapter.mp3', 'narration'],
  ]);
  return {
    files: [...content].map(([path, value]) => ({ path, uncompressedSize: Buffer.byteLength(value), stream: () => Readable.from([value]) })),
  } as unknown as unzipper.CentralDirectory;
}

describe('delivery EPUB XML resource references', () => {
  it('resolves escaped manifest and overlay resource attributes', async () => {
    await expect(inspectDeliveryEpub(publication('audio&amp;chapter.mp3', 'audio&amp;chapter.mp3'), 100, 4096)).resolves.toBe(true);
  });

  it('resolves numeric character references in overlay attributes', async () => {
    await expect(inspectDeliveryEpub(publication('audio%26chapter.mp3', 'audio&#38;chapter.mp3'), 100, 4096)).resolves.toBe(true);
  });

  it('rejects declared XML entities before parsing', async () => {
    const zip = publication('audio%26chapter.mp3', 'audio%26chapter.mp3', '<!DOCTYPE package [<!ENTITY injected "audio">]>');
    await expect(inspectDeliveryEpub(zip, 100, 4096)).rejects.toThrow('Invalid EPUB XML');
  });

  it('rejects an overlay that references a missing sentence in an existing chapter', async () => {
    const zip = publication('audio%26chapter.mp3', 'audio%26chapter.mp3', '', 'chapter.xhtml#missing');
    await expect(inspectDeliveryEpub(zip, 100, 4096)).rejects.toThrow('Missing overlay text target');
  });

  it('resolves percent-encoded sentence fragments', async () => {
    const zip = publication('audio%26chapter.mp3', 'audio%26chapter.mp3', '', 'chapter.xhtml#%73entence');
    await expect(inspectDeliveryEpub(zip, 100, 4096)).resolves.toBe(true);
  });

  it('rejects malformed fragment encoding', async () => {
    const zip = publication('audio%26chapter.mp3', 'audio%26chapter.mp3', '', 'chapter.xhtml#%ZZ');
    await expect(inspectDeliveryEpub(zip, 100, 4096)).rejects.toThrow('Invalid overlay fragment');
  });
});

describe('hasMultimediaEntries', () => {
  const files = (...paths: string[]) => paths.map((path) => ({ path })) as unknown as unzipper.File[];

  it('finds narration by entry name, including a percent-encoded one', () => {
    expect(hasMultimediaEntries(files('OPS/chapter.xhtml', 'OPS/Audio/track.M4A'))).toBe(true);
    expect(hasMultimediaEntries(files('OPS/chapter.xhtml', 'OPS/overlay%2Esmil'))).toBe(true);
  });

  it('reports a text-only archive, even with a malformed name, as plain', () => {
    expect(hasMultimediaEntries(files('OPS/chapter.xhtml', 'OPS/cover.jpg', 'OPS/100%.xhtml'))).toBe(false);
  });
});
