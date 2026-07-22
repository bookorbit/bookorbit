import { XMLParser } from 'fast-xml-parser';

import { inject, locate, replace } from './epub-cover-handler';

const jpegImage = { mediaType: 'image/jpeg', extension: 'jpg' };
const webpImage = { mediaType: 'image/webp', extension: 'webp' };

const objectParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true });

function parsePackage(xml: string): Record<string, any> {
  return objectParser.parse(xml).package;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (Array.isArray(value)) return value;
  return value === undefined ? [] : [value];
}

describe('epub-cover-handler', () => {
  it('locates an EPUB2 image cover through meta[name=cover] and decodes its href', async () => {
    const opf = `
      <package version="2.0">
        <metadata><meta name="cover" content="cover-id" /></metadata>
        <manifest><item id="cover-id" href="images%2Fcover.jpg" media-type="image/jpeg" /></manifest>
      </package>
    `;

    await expect(locate(opf, 'OPS/')).resolves.toEqual({
      entryPath: 'OPS/images/cover.jpg',
      mediaType: 'image/jpeg',
      manifestItemId: 'cover-id',
    });
  });

  it('prioritizes the EPUB3 cover-image property over stale EPUB2 metadata', async () => {
    const opf = `
      <package version="3.0">
        <metadata><meta name="cover" content="old" /></metadata>
        <manifest>
          <item id="old" href="images/old.jpg" media-type="image/jpeg" />
          <item id="current" href="../images/current.png" media-type="image/png" properties="nav cover-image" />
        </manifest>
      </package>
    `;

    await expect(locate(opf, 'OPS/content/')).resolves.toEqual({
      entryPath: 'OPS/images/current.png',
      mediaType: 'image/png',
      manifestItemId: 'current',
    });
  });

  it('follows an EPUB2 XHTML cover page to its manifested image', async () => {
    const opf = `
      <package version="2.0">
        <metadata><meta name="cover" content="cover-page" /></metadata>
        <manifest>
          <item id="cover-page" href="text/cover.xhtml" media-type="application/xhtml+xml" />
          <item id="art" href="images/art.png" media-type="image/png" />
        </manifest>
      </package>
    `;
    const readTextEntry = vi.fn().mockResolvedValue('<html><body><img alt="" src="../images/art.png" /></body></html>');

    await expect(locate(opf, 'OPS/', readTextEntry)).resolves.toEqual({
      entryPath: 'OPS/images/art.png',
      mediaType: 'image/png',
      manifestItemId: 'art',
      document: {
        entryPath: 'OPS/text/cover.xhtml',
        xml: '<html><body><img alt="" src="../images/art.png" /></body></html>',
        imageHref: '../images/art.png',
      },
    });
    expect(readTextEntry).toHaveBeenCalledWith('OPS/text/cover.xhtml');
  });

  it('uses the first valid image when a cover page contains multiple image elements', async () => {
    const opf = `
      <package version="2.0">
        <metadata><meta name="cover" content="cover-page" /></metadata>
        <manifest>
          <item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml" />
          <item id="first" href="images/first.jpg" media-type="image/jpeg" />
          <item id="second" href="images/second.jpg" media-type="image/jpeg" />
        </manifest>
      </package>
    `;
    const readTextEntry = vi.fn().mockResolvedValue('<html><body><img src="images/first.jpg" /><img src="images/second.jpg" /></body></html>');

    await expect(locate(opf, 'OPS/', readTextEntry)).resolves.toEqual({
      entryPath: 'OPS/images/first.jpg',
      mediaType: 'image/jpeg',
      manifestItemId: 'first',
      document: {
        entryPath: 'OPS/cover.xhtml',
        xml: '<html><body><img src="images/first.jpg" /><img src="images/second.jpg" /></body></html>',
        imageHref: 'images/first.jpg',
      },
    });
  });

  it('follows an EPUB2 guide reference and an SVG image href', async () => {
    const opf = `
      <package version="2.0">
        <metadata />
        <manifest>
          <item id="cover-page" href="cover.svg" media-type="image/svg+xml" />
          <item id="art" href="assets/cover.jpg" media-type="image/jpeg" />
        </manifest>
        <guide><reference type="cover" href="cover.svg#cover" /></guide>
      </package>
    `;
    const readTextEntry = vi.fn().mockResolvedValue('<svg xmlns:xlink="urn:x"><image xlink:href="assets/cover.jpg" /></svg>');

    await expect(locate(opf, 'OPS/', readTextEntry)).resolves.toEqual({
      entryPath: 'OPS/assets/cover.jpg',
      mediaType: 'image/jpeg',
      manifestItemId: 'art',
      document: {
        entryPath: 'OPS/cover.svg',
        xml: '<svg xmlns:xlink="urn:x"><image xlink:href="assets/cover.jpg" /></svg>',
        imageHref: 'assets/cover.jpg',
      },
    });
  });

  it.each([
    ['an external URL', 'https://example.com/cover.jpg'],
    ['an absolute path', '/etc/passwd'],
    ['a traversal path', '../../../outside.jpg'],
    ['a malformed encoded path', 'images/%ZZ.jpg'],
  ])('ignores %s in cover metadata', async (_label, href) => {
    const opf = `
      <package version="3.0">
        <metadata />
        <manifest><item id="cover" href="${href}" media-type="image/jpeg" properties="cover-image" /></manifest>
      </package>
    `;

    await expect(locate(opf, 'OPS/')).resolves.toBeNull();
  });

  it('skips unsafe and unmanifested images before using a valid cover-page image', async () => {
    const opf = `
      <package version="2.0">
        <metadata><meta name="cover" content="cover-page" /></metadata>
        <manifest>
          <item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml" />
          <item id="art" href="images/art.jpg" media-type="image/jpeg" />
        </manifest>
      </package>
    `;
    const documentXml =
      '<html><body><!-- <img src="images/art.jpg" /> --><img src="https://example.com/tracker.png" /><img src="images/art.jpg" /></body></html>';

    await expect(locate(opf, 'OPS/', vi.fn().mockResolvedValue(documentXml))).resolves.toEqual({
      entryPath: 'OPS/images/art.jpg',
      mediaType: 'image/jpeg',
      manifestItemId: 'art',
      document: { entryPath: 'OPS/cover.xhtml', xml: documentXml, imageHref: 'images/art.jpg' },
    });
  });

  it('injects one EPUB2 cover declaration without EPUB3-only properties', () => {
    const opf = `
      <package version="2.0">
        <metadata>
          <meta name="cover" content="stale-cover" />
          <meta name="keep" content="value" />
        </metadata>
        <manifest>
          <item id="stale-cover" href="old.jpg" media-type="image/jpeg" />
          <item id="other" href="chapter.xhtml" media-type="application/xhtml+xml" properties="scripted" />
        </manifest>
        <guide>
          <reference type="cover" href="old-cover.xhtml" />
          <reference type="toc" href="toc.xhtml" />
        </guide>
      </package>
    `;

    const result = inject(opf, 'OPS/', jpegImage, []);
    const pkg = parsePackage(result.updatedOpfXml);
    const metas = asArray(pkg.metadata.meta);
    const items = asArray(pkg.manifest.item);
    const references = asArray(pkg.guide.reference);
    const injectedItem = items.find((item) => item['@_id'] === 'bookorbit-cover-image');

    expect(result).toMatchObject({ newEntryPath: 'OPS/images/bookorbit-cover.jpg' });
    expect(metas.filter((meta) => meta['@_name'] === 'cover')).toEqual([expect.objectContaining({ '@_content': 'bookorbit-cover-image' })]);
    expect(metas).toContainEqual(expect.objectContaining({ '@_name': 'keep', '@_content': 'value' }));
    expect(injectedItem).toMatchObject({
      '@_href': 'images/bookorbit-cover.jpg',
      '@_media-type': 'image/jpeg',
    });
    expect(injectedItem).not.toHaveProperty('@_properties');
    expect(items.find((item) => item['@_id'] === 'other')).toHaveProperty('@_properties', 'scripted');
    expect(references).toEqual([expect.objectContaining({ '@_type': 'toc' })]);
  });

  it('injects EPUB3 cover-image metadata and removes stale cross-version declarations', () => {
    const opf = `
      <package version="3.0">
        <metadata>
          <meta name="cover" content="old" />
          <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
        </metadata>
        <manifest>
          <item id="old" href="old.webp" media-type="image/webp" properties="cover-image scripted" />
          <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml" />
        </manifest>
      </package>
    `;

    const result = inject(opf, '', webpImage, []);
    const pkg = parsePackage(result.updatedOpfXml);
    const metas = asArray(pkg.metadata.meta);
    const items = asArray(pkg.manifest.item);

    expect(metas.some((meta) => meta['@_name'] === 'cover')).toBe(false);
    expect(items.find((item) => item['@_id'] === 'old')).toHaveProperty('@_properties', 'scripted');
    expect(items.filter((item) => item['@_properties']?.split(/\s+/).includes('cover-image'))).toEqual([
      expect.objectContaining({
        '@_id': 'bookorbit-cover-image',
        '@_href': 'images/bookorbit-cover.webp',
        '@_media-type': 'image/webp',
      }),
    ]);
  });

  it('chooses a collision-free manifest id and entry path', () => {
    const opf = `
      <package version="3.0">
        <metadata />
        <manifest>
          <item id="bookorbit-cover-image" href="unrelated.xhtml" media-type="application/xhtml+xml" />
          <item id="other" href="images/bookorbit-cover-2.jpg" media-type="image/jpeg" />
        </manifest>
      </package>
    `;

    const result = inject(opf, 'OPS/', jpegImage, ['OPS/images/bookorbit-cover.jpg']);
    const items = asArray(parsePackage(result.updatedOpfXml).manifest.item);

    expect(result.newEntryPath).toBe('OPS/images/bookorbit-cover-3.jpg');
    expect(items).toContainEqual(
      expect.objectContaining({
        '@_id': 'bookorbit-cover-image-3',
        '@_href': 'images/bookorbit-cover-3.jpg',
      }),
    );
  });

  it('rejects packages without a supported EPUB version', () => {
    expect(() => inject('<package version="1.0"><metadata/><manifest/></package>', '', jpegImage, [])).toThrow('Unsupported EPUB version');
  });

  it('changes the manifest href and media type when the selected image format differs', () => {
    const opf = `
      <package version="3.0">
        <metadata />
        <manifest>
          <item id="cover" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image scripted" fallback="fallback-id" />
        </manifest>
      </package>
    `;

    const result = replace(opf, 'OPS/', { entryPath: 'OPS/images/cover.jpg', mediaType: 'image/jpeg', manifestItemId: 'cover' }, webpImage, [
      'OPS/images/cover.jpg',
    ]);
    const item = parsePackage(result!.updatedOpfXml).manifest.item;

    expect(result).toMatchObject({ newEntryPath: 'OPS/images/cover.webp' });
    expect(item).toMatchObject({
      '@_id': 'cover',
      '@_href': 'images/cover.webp',
      '@_media-type': 'image/webp',
      '@_properties': 'cover-image scripted',
      '@_fallback': 'fallback-id',
    });
  });

  it('leaves the OPF and entry path unchanged when the media type already matches', () => {
    const opf = '<package version="3.0"><metadata/><manifest><item id="cover" href="cover.jpg" media-type="image/jpeg"/></manifest></package>';

    expect(
      replace(opf, 'OPS/', { entryPath: 'OPS/cover.jpg', mediaType: 'image/jpeg', manifestItemId: 'cover' }, jpegImage, ['OPS/cover.jpg']),
    ).toEqual({ updatedOpfXml: opf, newEntryPath: 'OPS/cover.jpg' });
  });

  it('updates the manifested image and first XHTML image reference', () => {
    const opf = `
      <package version="2.0">
        <metadata><meta name="cover" content="cover-page" /></metadata>
        <manifest>
          <item id="cover-page" href="text/cover.xhtml" media-type="application/xhtml+xml" />
          <item id="art" href="images/old%20cover.png" media-type="image/png" />
        </manifest>
      </package>
    `;
    const documentXml = '<html><body><img alt="cover" src="../images/old%20cover.png" /><img src="keep.png" /></body></html>';

    const result = replace(
      opf,
      'OPS/',
      {
        entryPath: 'OPS/images/old cover.png',
        mediaType: 'image/png',
        manifestItemId: 'art',
        document: { entryPath: 'OPS/text/cover.xhtml', xml: documentXml, imageHref: '../images/old%20cover.png' },
      },
      jpegImage,
      ['OPS/images/old cover.png'],
    );

    expect(result).toMatchObject({
      newEntryPath: 'OPS/images/old cover.jpg',
      documentPatch: { entryPath: 'OPS/text/cover.xhtml' },
    });
    expect(parsePackage(result!.updatedOpfXml).manifest.item[1]).toMatchObject({
      '@_href': 'images/old%20cover.jpg',
      '@_media-type': 'image/jpeg',
    });
    expect(result!.documentPatch!.xml).toContain('src="../images/old%20cover.jpg"');
    expect(result!.documentPatch!.xml).toContain('src="keep.png"');
  });

  it('updates an SVG xlink:href while preserving the attribute form', () => {
    const result = replace(
      '<package version="2.0"><metadata/><manifest><item id="art" href="art.png" media-type="image/png"/></manifest></package>',
      'OPS/',
      {
        entryPath: 'OPS/art.png',
        mediaType: 'image/png',
        manifestItemId: 'art',
        document: { entryPath: 'OPS/cover.svg', xml: '<svg><image width="10" xlink:href="art.png" /></svg>', imageHref: 'art.png' },
      },
      webpImage,
      ['OPS/art.png'],
    );

    expect(result!.documentPatch!.xml).toBe('<svg><image width="10" xlink:href="art.webp" /></svg>');
  });

  it('uses a collision-free replacement path when the desired extension already exists', () => {
    const result = replace(
      '<package version="3.0"><metadata/><manifest><item id="cover" href="cover.jpg" media-type="image/jpeg"/></manifest></package>',
      'OPS/',
      { entryPath: 'OPS/cover.jpg', mediaType: 'image/jpeg', manifestItemId: 'cover' },
      webpImage,
      ['OPS/cover.jpg', 'OPS/cover.webp', 'OPS/cover-bookorbit-2.webp'],
    );

    expect(result!.newEntryPath).toBe('OPS/cover-bookorbit-3.webp');
    expect(parsePackage(result!.updatedOpfXml).manifest.item['@_href']).toBe('cover-bookorbit-3.webp');
  });

  it('locates and replaces a cover in an explicitly prefixed OPF package', async () => {
    const opf = `
      <opf:package xmlns:opf="http://www.idpf.org/2007/opf" version="2.0">
        <opf:metadata><opf:meta name="cover" content="cover" /></opf:metadata>
        <opf:manifest><opf:item id="cover" href="images/cover.jpg" media-type="image/jpeg" /></opf:manifest>
      </opf:package>
    `;
    const slot = await locate(opf, 'OEBPS/');

    expect(slot).toEqual({
      entryPath: 'OEBPS/images/cover.jpg',
      mediaType: 'image/jpeg',
      manifestItemId: 'cover',
    });

    const result = replace(opf, 'OEBPS/', slot!, webpImage, ['OEBPS/images/cover.jpg']);
    expect(result!.updatedOpfXml).toContain('<opf:item id="cover" href="images/cover.webp" media-type="image/webp"></opf:item>');
  });

  it('injects namespaced OPF item and meta elements into a prefixed package', () => {
    const opf = `
      <opf:package xmlns:opf="http://www.idpf.org/2007/opf" version="2.0">
        <opf:metadata />
        <opf:manifest />
      </opf:package>
    `;

    const result = inject(opf, 'OEBPS/', jpegImage, []);

    expect(result.updatedOpfXml).toContain('<opf:meta name="cover" content="bookorbit-cover-image"></opf:meta>');
    expect(result.updatedOpfXml).toContain(
      '<opf:item id="bookorbit-cover-image" href="images/bookorbit-cover.jpg" media-type="image/jpeg"></opf:item>',
    );
    expect(result.updatedOpfXml).not.toContain('<meta name="cover"');
    expect(result.updatedOpfXml).not.toContain('<item id="bookorbit-cover-image"');
  });
});
