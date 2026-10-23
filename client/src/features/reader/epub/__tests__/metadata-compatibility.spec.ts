import { afterEach, describe, expect, it } from 'vitest'

// @ts-expect-error public Foliate asset has no TypeScript declarations.
import { EPUB } from '../../../../../public/assets/foliate/epub.js'

const objectGroupBy = Object.getOwnPropertyDescriptor(Object, 'groupBy')!
const mapGroupBy = Object.getOwnPropertyDescriptor(Map, 'groupBy')!

afterEach(() => {
  Object.defineProperty(Object, 'groupBy', objectGroupBy)
  Object.defineProperty(Map, 'groupBy', mapGroupBy)
})

async function openEpub(version: string, extraMetadata: string) {
  const files: Record<string, string> = {
    'META-INF/container.xml': `<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    'OPS/book.opf': `<package xmlns="http://www.idpf.org/2007/opf" version="${version}" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf"><dc:identifier id="id">urn:uuid:compatibility-test</dc:identifier><dc:title id="title">Main title</dc:title><dc:creator id="author" opf:role="aut">Test author</dc:creator><dc:language>en</dc:language>${extraMetadata}</metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>`,
    'OPS/chapter.xhtml': `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title></head><body><p>Readable content.</p></body></html>`,
  }
  return new EPUB({
    loadText: async (uri: string) => files[uri] ?? null,
    loadBlob: async () => null,
    getSize: () => 0,
  }).init()
}

describe.each([
  { name: 'native grouping APIs', objectMissing: false, mapMissing: false },
  { name: 'Object.groupBy unavailable', objectMissing: true, mapMissing: false },
  { name: 'Map.groupBy unavailable', objectMissing: false, mapMissing: true },
  { name: 'both grouping APIs unavailable', objectMissing: true, mapMissing: true },
])('EPUB metadata with $name', ({ objectMissing, mapMissing }) => {
  function disableGroupingApis() {
    if (objectMissing) Object.defineProperty(Object, 'groupBy', { ...objectGroupBy, value: undefined })
    if (mapMissing) Object.defineProperty(Map, 'groupBy', { ...mapGroupBy, value: undefined })
  }

  it('opens EPUB 3 with grouped values, refinements, rendition and media metadata intact', async () => {
    const metadata = `<dc:title id="subtitle">Subtitle</dc:title><dc:language>fr</dc:language>
      <meta refines="#title" property="title-type">main</meta>
      <meta refines="#title" property="file-as">Title, Main</meta>
      <meta refines="#subtitle" property="title-type">subtitle</meta>
      <meta refines="#author" property="file-as">Author, Test</meta>
      <meta refines="#author" property="role">aut</meta>
      <meta property="belongs-to-collection" id="collection">Test collection</meta>
      <meta refines="#collection" property="collection-type">set</meta>
      <meta refines="#collection" property="group-position">2</meta>
      <meta property="rendition:layout">pre-paginated</meta>
      <meta property="media:duration">00:01:30</meta>
      <meta property="__proto__">Untrusted property</meta>
      <meta property="constructor">Another untrusted property</meta>`
    const baseline = await openEpub('3.0', metadata)
    disableGroupingApis()

    const book = await openEpub('3.0', metadata)

    expect(book.metadata).toEqual(baseline.metadata)
    expect(book.metadata).toMatchObject({
      title: 'Main title',
      sortAs: 'Title, Main',
      subtitle: 'Subtitle',
      author: { name: 'Test author', sortAs: 'Author, Test' },
      language: ['en', 'fr'],
      belongsTo: { collection: { name: 'Test collection', position: '2' } },
    })
    expect(book.rendition).toEqual({ layout: 'pre-paginated' })
    expect(book.media).toEqual({ duration: 90 })
    expect(book.sections.map((section: { id: string }) => section.id)).toEqual(['OPS/chapter.xhtml'])
    const chapter = await book.sections[0].createDocument()
    expect(chapter.querySelector('p')?.textContent).toBe('Readable content.')
    expect(Object.getOwnPropertyDescriptor(Object, 'groupBy')?.value).toBe(objectMissing ? undefined : objectGroupBy.value)
    expect(Object.getOwnPropertyDescriptor(Map, 'groupBy')?.value).toBe(mapMissing ? undefined : mapGroupBy.value)
  })

  it('opens EPUB 2 without refinement metadata and preserves legacy series metadata', async () => {
    disableGroupingApis()

    const book = await openEpub('2.0', '<meta name="calibre:series" content="Test series"/><meta name="calibre:series_index" content="3"/>')

    expect(book.metadata).toMatchObject({
      title: 'Main title',
      author: { name: 'Test author', role: 'aut' },
      language: 'en',
      belongsTo: { series: { name: 'Test series', position: 3 } },
    })
    expect(book.rendition).toEqual({})
    expect(book.media).toEqual({})
    expect(book.sections).toHaveLength(1)
  })
})
