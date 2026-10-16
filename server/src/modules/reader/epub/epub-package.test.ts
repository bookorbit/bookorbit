import { parseEpubPackage } from './epub-package';

describe('EPUB package namespaces', () => {
  it('keeps creator order across different aliases of the Dublin Core namespace', () => {
    const pkg = parseEpubPackage(`<package xmlns="http://www.idpf.org/2007/opf">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:d="http://purl.org/dc/elements/1.1/">
        <dc:creator>First author</dc:creator><d:creator>Second author</d:creator><dc:creator>Third author</dc:creator>
      </metadata>
    </package>`);

    expect(pkg['metadata']).toMatchObject({ 'dc:creator': ['First author', 'Second author', 'Third author'] });
  });

  it('does not let namespace rebinding on a sibling leak into later metadata fields', () => {
    const pkg = parseEpubPackage(`<package xmlns="http://www.idpf.org/2007/opf">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:language xmlns:dc="urn:other">de</dc:language><dc:language>pt</dc:language>
        <language xmlns="urn:other">fr</language>
      </metadata>
    </package>`);

    expect(pkg['metadata']).toMatchObject({ 'dc:language': 'pt' });
    expect(pkg['metadata']).not.toHaveProperty('language');
  });

  it.each(['xmlns:p="urn:other"', ''])('rejects a foreign or undeclared package prefix with %s', (declaration) => {
    expect(parseEpubPackage(`<p:package ${declaration}><metadata><dc:language>de</dc:language></metadata></p:package>`)).toEqual({});
  });

  it('preserves opaque identifiers, entities, attribute names and colon-bearing attribute values', () => {
    const pkg = parseEpubPackage(`<p:package xmlns:p="http://www.idpf.org/2007/opf">
      <p:metadata xmlns:d="http://purl.org/dc/elements/1.1/">
        <d:title>Livro &amp; biblioteca</d:title><d:identifier>0000123</d:identifier>
        <p:meta property="media:duration" refines="#overlay">21103.35</p:meta>
      </p:metadata>
      <p:manifest><p:item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml" media-overlay="overlay"/></p:manifest>
    </p:package>`);

    expect(pkg['metadata']).toMatchObject({
      'dc:title': 'Livro & biblioteca',
      'dc:identifier': '0000123',
      meta: { '@_property': 'media:duration', '@_refines': '#overlay', '#text': '21103.35' },
    });
    expect(pkg['manifest']).toEqual({
      item: { '@_id': 'chapter', '@_href': 'chapter.xhtml', '@_media-type': 'application/xhtml+xml', '@_media-overlay': 'overlay' },
    });
  });
});
