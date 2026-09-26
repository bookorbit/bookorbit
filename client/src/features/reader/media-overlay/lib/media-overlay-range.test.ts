import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// @ts-expect-error public Foliate asset has no TypeScript declarations.
import { EPUB } from '../../../../../public/assets/foliate/epub.js'
import { mediaOverlayEntriesOverlapping } from './media-overlay-range'

// Section bodies are Storyteller's own output for these source shapes (its
// `markupChapter`, `epub:type` attributes dropped). Storyteller wraps each
// sentence in a span but keeps the book's inline elements inside it with their
// ids, which is what bookorbit/bookorbit#1528 tripped over.
const sentenceBody = `
<h1 id="heading">Chapter One</h1>
<p><span id="c-s1">The keeper climbed the stairs. </span><span id="c-s2">Salt had crusted on every rail.</span></p>
<p><span id="c-s3"><span class="koboSpan" id="kobo.4.1">The lamp turned above the harbor. </span></span><span id="c-s4"><span class="koboSpan" id="kobo.4.2">Fishing boats waited for the tide.</span></span></p>
<p class="calibre"><span id="c-s5"><span class="calibre1" id="calibre_link-12">Gulls circled the breakwater. </span></span><span id="c-s6"><span class="calibre1">Rain moved in from the west.</span></span></p>
`
const sentenceIds = ['c-s1', 'c-s2', 'c-s3', 'c-s4', 'c-s5', 'c-s6']

const wordBody = `
<p><span id="c-s0"><span id="c-s0-w0"><span class="koboSpan" id="kobo.9.1">Waves</span></span><span class="koboSpan"> </span><span id="c-s0-w1"><span class="koboSpan">broke</span></span><span class="koboSpan">. </span></span><span id="c-s1"><span id="c-s1-w0"><span class="koboSpan" id="kobo.9.2">Nets</span></span><span class="koboSpan"> </span><span id="c-s1-w1"><span class="koboSpan">dried</span></span><span class="koboSpan">.</span></span></p>
`
const wordIds = ['c-s0-w0', 'c-s0-w1', 'c-s1-w0', 'c-s1-w1']

function chapter(body: string): Document {
  return new DOMParser().parseFromString(
    `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>c</title></head><body>${body}</body></html>`,
    'application/xhtml+xml',
  )
}

function textPosition(doc: Document, id: string, needle: string): { node: Text; offset: number } {
  const root = doc.getElementById(id)
  if (!root) throw new Error(`no element #${id}`)
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const offset = (node as Text).data.indexOf(needle)
    if (offset >= 0) return { node: node as Text, offset }
  }
  throw new Error(`no text "${needle}" in #${id}`)
}

// The range a reader gets by selecting from `from` through `to`, each a word
// looked up inside the element with the given id.
function selection(doc: Document, from: [string, string], to: [string, string] = from): Range {
  const start = textPosition(doc, from[1], from[0])
  const end = textPosition(doc, to[1], to[0])
  const range = doc.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset + to[0].length)
  return range
}

function entry(id: string): { text: string } {
  return { text: `OPS/chapter.xhtml#${id}` }
}

function acceptedIds(range: Range, ids: string[]): string[] {
  const matches = mediaOverlayEntriesOverlapping(range)
  return ids.filter((id) => matches(entry(id)))
}

describe('mediaOverlayEntriesOverlapping', () => {
  it('accepts the sentence around a Kobo span rather than needing the Kobo id', () => {
    const doc = chapter(sentenceBody)

    expect(acceptedIds(selection(doc, ['lamp', 'c-s3']), sentenceIds)).toEqual(['c-s3'])
    expect(acceptedIds(selection(doc, ['tide', 'c-s4']), sentenceIds)).toEqual(['c-s4'])
  })

  it('accepts the sentence around a calibre span, with or without the id Storyteller kept', () => {
    const doc = chapter(sentenceBody)

    expect(acceptedIds(selection(doc, ['breakwater', 'c-s5']), sentenceIds)).toEqual(['c-s5'])
    expect(acceptedIds(selection(doc, ['west', 'c-s6']), sentenceIds)).toEqual(['c-s6'])
  })

  it('accepts the sentence a selection sits in when the span holds only text', () => {
    const doc = chapter(sentenceBody)

    expect(acceptedIds(selection(doc, ['keeper', 'c-s1']), sentenceIds)).toEqual(['c-s1'])
    expect(acceptedIds(selection(doc, ['rail', 'c-s2']), sentenceIds)).toEqual(['c-s2'])
  })

  it('accepts every sentence a selection touches and none it does not', () => {
    const doc = chapter(sentenceBody)

    expect(acceptedIds(selection(doc, ['lamp', 'c-s3'], ['Gulls', 'c-s5']), sentenceIds)).toEqual(['c-s3', 'c-s4', 'c-s5'])
  })

  it('accepts the word span of a word-level overlay past the Kobo id inside it', () => {
    const doc = chapter(wordBody)

    expect(acceptedIds(selection(doc, ['Waves', 'c-s0-w0']), wordIds)).toEqual(['c-s0-w0'])
    expect(acceptedIds(selection(doc, ['dried', 'c-s1-w1']), wordIds)).toEqual(['c-s1-w1'])
  })

  it('accepts nothing for text the overlay does not narrate', () => {
    const doc = chapter(sentenceBody)

    expect(acceptedIds(selection(doc, ['Chapter', 'heading']), sentenceIds)).toEqual([])
  })

  it('finds an entry that names an anchor instead of an id, as foliate does', () => {
    const doc = chapter('<p id="para"><a name="old-anchor">An older book marks its sentences by name.</a></p>')

    expect(mediaOverlayEntriesOverlapping(selection(doc, ['older', 'para']))(entry('old-anchor'))).toBe(true)
  })

  it('rejects entries that name no element or no fragment at all', () => {
    const doc = chapter(sentenceBody)
    const matches = mediaOverlayEntriesOverlapping(selection(doc, ['lamp', 'c-s3']))

    expect(matches(entry('missing'))).toBe(false)
    expect(matches({ text: 'OPS/chapter.xhtml' })).toBe(false)
  })
})

class FakeAudio extends EventTarget {
  static instances: FakeAudio[] = []

  paused = true
  currentTime = 0
  volume = 1
  playbackRate = 1

  constructor() {
    super()
    FakeAudio.instances.push(this)
  }

  play(): Promise<void> {
    this.paused = false
    this.dispatchEvent(new Event('playing'))
    return Promise.resolve()
  }

  pause(): void {
    this.paused = true
  }
}

function smil(ids: string[]): string {
  const pars = ids
    .map((id, index) => `<par><text src="chapter.xhtml#${id}"/><audio src="audio.mp3" clipBegin="${index}s" clipEnd="${index + 1}s"/></par>`)
    .join('')
  return `<?xml version="1.0"?><smil xmlns="http://www.w3.org/ns/SMIL"><body><seq>${pars}</seq></body></smil>`
}

// Starts the real vendored engine with the filter and reports the entry it
// highlights, which is the sentence the reader hears first.
async function startedEntry(ids: string[], range: Range): Promise<string | null> {
  const book = new EPUB({
    loadText: async (src: string) => (src === 'OPS/chapter.smil' ? smil(ids) : null),
    loadBlob: async () => new Blob(['audio']),
    getSize: () => 0,
  })
  book.sections = [{ id: 'OPS/chapter.xhtml', mediaOverlay: { href: 'OPS/chapter.smil' } }]
  const overlay = book.getMediaOverlay()
  const highlights: string[] = []
  overlay.addEventListener('highlight', (event: Event) => highlights.push((event as CustomEvent<{ text: string }>).detail.text))

  const started = await overlay.start(0, mediaOverlayEntriesOverlapping(range))
  FakeAudio.instances.at(-1)?.dispatchEvent(new Event('canplaythrough'))
  overlay.stop()
  if (!started) return null
  return highlights[0]?.split('#')[1] ?? null
}

describe('starting Foliate narration from a range', () => {
  const originalAudio = globalThis.Audio
  const originalCreateObjectURL = URL.createObjectURL
  const originalRevokeObjectURL = URL.revokeObjectURL

  beforeEach(() => {
    FakeAudio.instances = []
    globalThis.Audio = FakeAudio as unknown as typeof Audio
    URL.createObjectURL = vi.fn<(object: Blob | MediaSource) => string>(() => 'blob:media-overlay')
    URL.revokeObjectURL = vi.fn<(url: string) => void>()
  })

  afterEach(() => {
    globalThis.Audio = originalAudio
    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevokeObjectURL
    vi.restoreAllMocks()
  })

  it('starts at the selected sentence inside a Kobo span', async () => {
    const doc = chapter(sentenceBody)

    await expect(startedEntry(sentenceIds, selection(doc, ['lamp', 'c-s3']))).resolves.toBe('c-s3')
  })

  it('starts a selection across sentences at the first one in reading order', async () => {
    const doc = chapter(sentenceBody)

    await expect(startedEntry(sentenceIds, selection(doc, ['lamp', 'c-s3'], ['Gulls', 'c-s5']))).resolves.toBe('c-s3')
  })

  it('starts a selection beginning between sentences at the next one', async () => {
    const doc = chapter('<p id="para-9"><span id="t-1">First line here.</span> <span id="t-2">Second line here.</span></p>')

    await expect(startedEntry(['t-1', 't-2'], selection(doc, [' ', 'para-9'], ['Second', 't-2']))).resolves.toBe('t-2')
  })

  it('starts a word-level overlay at the selected word', async () => {
    const doc = chapter(wordBody)

    await expect(startedEntry(wordIds, selection(doc, ['Waves', 'c-s0-w0']))).resolves.toBe('c-s0-w0')
  })

  it('starts nothing for text the overlay does not narrate', async () => {
    const doc = chapter(sentenceBody)

    await expect(startedEntry(sentenceIds, selection(doc, ['Chapter', 'heading']))).resolves.toBeNull()
  })
})
