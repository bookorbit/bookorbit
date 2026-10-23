import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scalePublisherFontSizes } from '../lib/publisher-font-sizes'

// @ts-expect-error public Foliate asset has no TypeScript declarations.
import { EPUB } from '../../../../../public/assets/foliate/epub.js'

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`

const OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" unique-identifier="id" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Sizes</dc:title><dc:identifier id="id">urn:uuid:sizes</dc:identifier><dc:language>en</dc:language></metadata>
  <manifest>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="style" href="style.css" media-type="text/css"/>
  </manifest>
  <spine><itemref idref="chapter"/></spine>
</package>`

const STYLESHEET = 'body { font-size: medium; }\nh1 { font-size: 1.5em; }'

const CHAPTER = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title><link rel="stylesheet" type="text/css" href="style.css"/><style>p.note { font-size: small; }</style></head>
<body><p style="font-size: 10pt">Set font-size: 12px in your stylesheet.</p>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20"><style>text { font-size: 12px; }</style><text x="0" y="15" style="font-size: 12px">Label</text></svg>
</body></html>`

const files: Record<string, string> = {
  'META-INF/container.xml': CONTAINER,
  'OPS/book.opf': OPF,
  'OPS/style.css': STYLESHEET,
  'OPS/chapter.xhtml': CHAPTER,
}

async function loadChapter(configure: (book: { transformTarget: EventTarget }) => void = () => {}) {
  const book = await new EPUB({
    loadText: async (uri: string) => files[uri] ?? null,
    loadBlob: async () => null,
    getSize: () => 0,
  }).init()
  configure(book)
  const loaded = new Map<string, string>()
  book.transformTarget.addEventListener('data', (event: Event) => {
    const detail = (event as CustomEvent<{ name: string; data: string }>).detail
    loaded.set(detail.name, detail.data)
  })
  await book.sections[0].load()
  return { css: loaded.get('OPS/style.css')!, chapter: new DOMParser().parseFromString(loaded.get('OPS/chapter.xhtml')!, 'application/xhtml+xml') }
}

describe('publisher font sizes in the EPUB loader', () => {
  const originalCreateObjectURL = URL.createObjectURL

  beforeEach(() => {
    URL.createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:resource')
  })

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL
  })

  it('passes book CSS through unchanged when nothing listens for it', async () => {
    const { css, chapter } = await loadChapter()

    expect(css).toBe(STYLESHEET)
    expect(chapter.querySelector('head > style')?.textContent).toBe('p.note { font-size: small; }')
    expect(chapter.querySelector('p')?.getAttribute('style')).toBe('font-size: 10pt')
  })

  it('makes stylesheet, style element and style attribute sizes scalable', async () => {
    const { css, chapter } = await loadChapter(scalePublisherFontSizes)

    expect(css).toBe('body { font-size: var(--bookorbit-font-medium, medium); }\nh1 { font-size: 1.5em; }')
    expect(chapter.querySelector('head > style')?.textContent).toBe('p.note { font-size: var(--bookorbit-font-small, small); }')
    expect(chapter.querySelector('p')?.getAttribute('style')).toBe('font-size: calc(10pt * var(--bookorbit-font-scale, 1))')
  })

  it('leaves book text and SVG drawings untouched', async () => {
    const { chapter } = await loadChapter(scalePublisherFontSizes)
    const svg = chapter.getElementsByTagNameNS('http://www.w3.org/2000/svg', 'svg')[0]!

    expect(chapter.querySelector('p')?.textContent).toBe('Set font-size: 12px in your stylesheet.')
    expect(svg.getElementsByTagNameNS('http://www.w3.org/2000/svg', 'style')[0]?.textContent).toBe('text { font-size: 12px; }')
    expect(svg.getElementsByTagNameNS('http://www.w3.org/2000/svg', 'text')[0]?.getAttribute('style')).toBe('font-size: 12px')
  })
})
