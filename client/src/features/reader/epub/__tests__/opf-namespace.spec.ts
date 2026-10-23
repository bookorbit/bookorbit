import { describe, expect, it } from 'vitest'

// @ts-expect-error public Foliate asset has no TypeScript declarations.
import { EPUB } from '../../../../../public/assets/foliate/epub.js'

const OPF_NS = 'http://www.idpf.org/2007/opf'
const DC_NS = 'http://purl.org/dc/elements/1.1/'

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OPS/fb.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`

const NCX = `<?xml version="1.0" encoding="UTF-8"?>
<ncx version="2005-1" xmlns="http://www.daisy.org/z3986/2005/ncx/">
  <navMap>
    <navPoint id="coverpage" playOrder="0"><navLabel><text>封面</text></navLabel><content src="coverpage.html"/></navPoint>
    <navPoint id="chapter1" playOrder="1"><navLabel><text>第一章 白纸人</text></navLabel><content src="chapter1.html"/></navPoint>
  </navMap>
</ncx>`

interface OpfShape {
  rootAttributes: string
  // `opf:` when every OPF element is qualified with a prefix instead of relying on a default xmlns
  prefix?: string
  version?: string
  extraMetadata?: string
  beforeSpine?: string
}

// The shape epubBuilder writes (bookorbit/bookorbit#1680): Dublin Core and `opf:` bound on <metadata>,
// EPUB 2 `meta name="cover"`, an NCX toc, and a guide.
function opfDocument({ rootAttributes, prefix = '', version = '2.0', extraMetadata = '', beforeSpine = '' }: OpfShape): string {
  const p = prefix
  return `<?xml version="1.0" encoding="UTF-8"?><${p}package version="${version}" unique-identifier="PrimaryID" ${rootAttributes}><${p}metadata xmlns:dc="${DC_NS}" xmlns:opf="${OPF_NS}"><dc:title>鬼吹灯Ⅰ</dc:title><dc:creator opf:role="aut" opf:file-as="天下霸唱">天下霸唱</dc:creator><dc:language>zh-CN</dc:language><dc:identifier id="PrimaryID">urn:isbn:9787539628042</dc:identifier><${p}meta name="cover" content="cover-image"/>${extraMetadata}</${p}metadata><${p}manifest><${p}item id="coverpage" href="coverpage.html" media-type="application/xhtml+xml"/><${p}item id="chapter1" href="chapter1.html" media-type="application/xhtml+xml"/><${p}item id="ncx" href="fb.ncx" media-type="application/x-dtbncx+xml"/><${p}item id="cover-image" href="images/cover.jpg" media-type="image/jpeg"/></${p}manifest>${beforeSpine}<${p}spine toc="ncx"><${p}itemref idref="coverpage" linear="yes"/><${p}itemref idref="chapter1" linear="yes"/></${p}spine><${p}guide><${p}reference type="cover" title="封面" href="coverpage.html"/></${p}guide></${p}package>`
}

async function openEpub(opf: string) {
  const files: Record<string, string> = {
    'META-INF/container.xml': CONTAINER,
    'OPS/fb.opf': opf,
    'OPS/fb.ncx': NCX,
  }
  const book = new EPUB({
    loadText: async (uri: string) => files[uri] ?? null,
    loadBlob: async () => null,
    getSize: () => 0,
  })
  return book.init()
}

describe('EPUB package namespace handling', () => {
  it.each([
    {
      name: 'the shipped file: `mlns` typo with `opf:` also bound on <package>',
      rootAttributes: `mlns="${OPF_NS}" xmlns:opf="${OPF_NS}" xmlns:dc="${DC_NS}"`,
    },
    {
      name: 'the epubBuilder original: `mlns` typo with `opf:` bound only on <metadata>',
      rootAttributes: `mlns="${OPF_NS}"`,
    },
    { name: 'no namespace at all', rootAttributes: '' },
    { name: 'a default xmlns', rootAttributes: `xmlns="${OPF_NS}"` },
    { name: 'a default xmlns with `opf:` also bound on <package>', rootAttributes: `xmlns="${OPF_NS}" xmlns:opf="${OPF_NS}"` },
    { name: 'prefixed `opf:` elements', rootAttributes: `xmlns:opf="${OPF_NS}"`, prefix: 'opf:' },
  ])('reads the spine, manifest, toc, cover and metadata with $name', async ({ rootAttributes, prefix }) => {
    const book = await openEpub(opfDocument({ rootAttributes, prefix }))

    expect(book.sections.map((section: { id: string }) => section.id)).toEqual(['OPS/coverpage.html', 'OPS/chapter1.html'])
    expect(book.toc.map((item: { label: string; href: string }) => [item.label, item.href])).toEqual([
      ['封面', 'OPS/coverpage.html'],
      ['第一章 白纸人', 'OPS/chapter1.html'],
    ])
    expect(book.resources.cover?.href).toBe('OPS/images/cover.jpg')
    expect(book.landmarks).toEqual([{ label: '封面', type: ['cover'], href: 'OPS/coverpage.html' }])
    expect(book.metadata.title).toBe('鬼吹灯Ⅰ')
    expect(book.metadata.author).toMatchObject({ name: '天下霸唱', sortAs: '天下霸唱' })
    expect(book.metadata.language).toBe('zh-CN')
  })

  it.each([
    { name: 'with `opf:` bound on <package>', rootAttributes: `mlns="${OPF_NS}" xmlns:opf="${OPF_NS}"` },
    { name: 'with `opf:` bound only on <metadata>', rootAttributes: `mlns="${OPF_NS}"` },
  ])('reads OPF <meta> entries when the package has lost its default xmlns, $name', async ({ rootAttributes }) => {
    const book = await openEpub(
      opfDocument({
        rootAttributes,
        version: '3.0',
        extraMetadata:
          '<meta property="rendition:layout">pre-paginated</meta><meta name="calibre:series" content="鬼吹灯"/><meta name="calibre:series_index" content="2"/>',
      }),
    )

    expect(book.rendition.layout).toBe('pre-paginated')
    expect(book.metadata.belongsTo.series).toEqual({ name: '鬼吹灯', position: 2 })
  })

  it('still ignores same-named elements from other namespaces when the package is namespaced', async () => {
    const book = await openEpub(
      opfDocument({
        rootAttributes: `xmlns="${OPF_NS}"`,
        beforeSpine: '<x:spine xmlns:x="urn:example:other"><x:itemref idref="chapter1"/></x:spine>',
        extraMetadata: '<x:meta xmlns:x="urn:example:other" property="rendition:layout">pre-paginated</x:meta>',
      }),
    )

    expect(book.sections.map((section: { id: string }) => section.id)).toEqual(['OPS/coverpage.html', 'OPS/chapter1.html'])
    expect(book.rendition.layout).toBeUndefined()
  })
})
