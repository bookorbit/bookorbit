import { Readable } from 'stream';
import type * as unzipper from 'unzipper';
import { inspectDeliveryEpub } from './epub-delivery-validation';

function publication(opfAudioHref: string, smilAudioHref: string, prolog = ''): unzipper.CentralDirectory {
  const content = new Map([
    ['META-INF/container.xml', '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>'],
    [
      'OPS/book.opf',
      `${prolog}<package><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml" media-overlay="overlay"/><item id="overlay" href="overlay.smil" media-type="application/smil+xml"/><item id="audio" href="${opfAudioHref}" media-type="audio/mpeg"/></manifest><spine><itemref idref="chapter"/></spine></package>`,
    ],
    ['OPS/chapter.xhtml', '<html><body><p id="sentence">Hello</p></body></html>'],
    ['OPS/overlay.smil', `<smil><body><par><text src="chapter.xhtml#sentence"/><audio src="${smilAudioHref}"/></par></body></smil>`],
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
});
