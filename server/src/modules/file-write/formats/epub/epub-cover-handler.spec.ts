import { inject, locate } from './epub-cover-handler';

describe('epub-cover-handler', () => {
  const opfWithEpub2Cover = `
    <package version="2.0">
      <metadata>
        <meta name="cover" content="cover-id" />
      </metadata>
      <manifest>
        <item id="cover-id" href="images%2Fcover.jpg" media-type="image/jpeg" />
      </manifest>
    </package>
  `;

  it('locates EPUB2 cover via meta[name=cover] and decodes href', () => {
    const slot = locate(opfWithEpub2Cover, 'OPS/');

    expect(slot).toEqual({
      entryPath: 'OPS/images/cover.jpg',
      mediaType: 'image/jpeg',
    });
  });

  it('locates EPUB3 cover via properties="cover-image"', () => {
    const opf = `
      <package version="3.0">
        <metadata />
        <manifest>
          <item id="c1" href="../images/c.png" media-type="image/png" properties="cover-image" />
        </manifest>
      </package>
    `;

    const slot = locate(opf, 'OPS/content/');
    expect(slot).toEqual({ entryPath: 'OPS/images/c.png', mediaType: 'image/png' });
  });

  it('inject adds cover manifest + metadata entry and returns new image path', () => {
    const opf = `
      <package version="2.0">
        <metadata></metadata>
        <manifest></manifest>
      </package>
    `;

    const result = inject(opf, 'OPS/', Buffer.from([0xff, 0xd8, 0xff, 0x00]));

    expect(result.newEntryPath).toBe('OPS/images/cover.jpg');
    expect(result.updatedOpfXml).toContain('cover-image');
    expect(result.updatedOpfXml).toContain('name="cover"');
    expect(result.updatedOpfXml).toContain('media-type="image/jpeg"');
  });

  it('inject supports opf:metadata namespaced blocks for EPUB2 compatibility', () => {
    const opf = `
      <package version="3.0">
        <opf:metadata></opf:metadata>
        <manifest></manifest>
      </package>
    `;

    const result = inject(opf, '', Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    expect(result.newEntryPath).toBe('images/cover.png');
    expect(result.updatedOpfXml).toContain('<opf:metadata>');
    expect(result.updatedOpfXml).toContain('name="cover"');
    expect(result.updatedOpfXml).toContain('media-type="image/png"');
  });
});
