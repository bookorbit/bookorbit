import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('../api/tts.api', () => ({
  getChapterText: vi.fn<() => Promise<unknown>>(),
}))

import * as ttsApi from '../api/tts.api'
import { useFoliateTts } from './useFoliateTts'

// ─── Helpers ──────────────────────────────────────────────────────────────────

type MockOverlayer = { add: Mock; remove: Mock }

function makeOverlayer(): MockOverlayer {
  return { add: vi.fn<() => void>(), remove: vi.fn<() => void>() }
}

function makeChapterDoc(paragraphs: string[]): Document {
  const doc = document.implementation.createHTMLDocument('chapter')
  for (const text of paragraphs) {
    const p = doc.createElement('p')
    p.textContent = text
    doc.body.appendChild(p)
  }
  return doc
}

function rangeInParagraph(doc: Document, index: number): Range {
  const p = doc.body.children[index] as HTMLElement
  const range = doc.createRange()
  range.selectNodeContents(p.firstChild ?? p)
  return range
}

function makeView(doc: Document, overlayer: MockOverlayer) {
  const div = document.createElement('div')
  const scrollToAnchor = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
  const getContents = vi.fn<() => unknown[]>(() => [{ index: 0, doc, overlayer }])
  const view = Object.assign(div, {
    renderer: { getContents, scrollToAnchor },
    resolveCFI: vi.fn<() => undefined>(() => undefined),
  })
  return { view, scrollToAnchor }
}

async function setup(paragraphs: string[]) {
  const composable = useFoliateTts()
  const doc = makeChapterDoc(paragraphs)
  const overlayer = makeOverlayer()
  const { view, scrollToAnchor } = makeView(doc, overlayer)
  composable.setFoliateSource(doc, view as unknown as HTMLElement)
  await vi.waitFor(() => expect(composable.foliateReady.value).toBe(true))
  return { composable, doc, overlayer, scrollToAnchor }
}

function mockChapterText(paragraphs: string[]) {
  ;(ttsApi.getChapterText as Mock).mockResolvedValue({
    chapterIndex: 0,
    sentences: paragraphs.map((text, index) => ({ text, index })),
  })
}

afterEach(() => {
  useFoliateTts().clearFoliateSource()
  vi.clearAllMocks()
})

// ─── getServerTextBlocks ────────────────────────────────────────────────────

describe('getServerTextBlocks', () => {
  it('returns server paragraph blocks 1:1 without grouping or splitting', async () => {
    mockChapterText(['First paragraph.', 'Second paragraph. With two sentences.', 'Third.'])
    const { getServerTextBlocks } = useFoliateTts()
    const blocks = await getServerTextBlocks(1, 0)
    expect(blocks).toEqual(['First paragraph.', 'Second paragraph. With two sentences.', 'Third.'])
  })

  it('keeps a multi-sentence paragraph as a single block', async () => {
    const paragraph = Array.from({ length: 5 }, (_, i) => `Sentence ${i + 1}.`).join(' ')
    mockChapterText([paragraph])
    const { getServerTextBlocks } = useFoliateTts()
    const blocks = await getServerTextBlocks(1, 0)
    expect(blocks).toEqual([paragraph])
  })

  it('returns empty array for empty chapter', async () => {
    mockChapterText([])
    const { getServerTextBlocks } = useFoliateTts()
    expect(await getServerTextBlocks(1, 0)).toEqual([])
  })
})

// ─── getBlockIndexForRange ──────────────────────────────────────────────────

describe('getBlockIndexForRange', () => {
  it('maps a range to the paragraph index that contains it', async () => {
    const { composable, doc } = await setup(['Alpha paragraph.', 'Bravo paragraph.', 'Charlie paragraph.'])
    expect(composable.getBlockIndexForRange(rangeInParagraph(doc, 0))).toBe(0)
    expect(composable.getBlockIndexForRange(rangeInParagraph(doc, 1))).toBe(1)
    expect(composable.getBlockIndexForRange(rangeInParagraph(doc, 2))).toBe(2)
  })

  it('returns -1 for a null range', async () => {
    const { composable } = await setup(['Only paragraph.'])
    expect(composable.getBlockIndexForRange(null)).toBe(-1)
  })

  it('returns -1 for a range from a different document', async () => {
    const { composable } = await setup(['Paragraph one.', 'Paragraph two.'])
    const otherDoc = makeChapterDoc(['Foreign paragraph.'])
    expect(composable.getBlockIndexForRange(rangeInParagraph(otherDoc, 0))).toBe(-1)
  })

  it('returns -1 when no chapter source is set', () => {
    const composable = useFoliateTts()
    composable.clearFoliateSource()
    const doc = makeChapterDoc(['x'])
    expect(composable.getBlockIndexForRange(rangeInParagraph(doc, 0))).toBe(-1)
  })

  // Mirror of the server's htmlToBlocks behaviour: content before the first
  // block-level element is not its own block, so the first paragraph is index
  // 0 on both sides. If these diverged, audio would play one paragraph off.
  it('ignores leading content before the first block element so the first paragraph is index 0', async () => {
    const composable = useFoliateTts()
    const doc = document.implementation.createHTMLDocument('chapter')
    doc.body.appendChild(doc.createTextNode('Leading intro text'))
    const p1 = doc.createElement('p')
    p1.textContent = 'First para.'
    doc.body.appendChild(p1)
    const p2 = doc.createElement('p')
    p2.textContent = 'Second para.'
    doc.body.appendChild(p2)
    const overlayer = makeOverlayer()
    const { view } = makeView(doc, overlayer)
    composable.setFoliateSource(doc, view as unknown as HTMLElement)
    await vi.waitFor(() => expect(composable.foliateReady.value).toBe(true))

    const range = doc.createRange()
    range.selectNodeContents(p1.firstChild!)
    expect(composable.getBlockIndexForRange(range)).toBe(0)

    composable.highlightBlock(0)
    expect((overlayer.add.mock.calls[0]![1] as Range).toString().trim()).toBe('First para.')
  })
})

// ─── highlightBlock ─────────────────────────────────────────────────────────

describe('highlightBlock', () => {
  it('highlights the whole paragraph range for the given block index', async () => {
    const { composable, overlayer } = await setup(['First paragraph.', 'Second paragraph.'])
    const ok = composable.highlightBlock(1)
    expect(ok).toBe(true)
    expect(overlayer.add).toHaveBeenCalledTimes(1)
    const highlightedRange = overlayer.add.mock.calls[0]![1] as Range
    expect(highlightedRange.toString().trim()).toBe('Second paragraph.')
  })

  it('scrolls the highlighted block into view by default', async () => {
    const { composable, scrollToAnchor } = await setup(['First.', 'Second.'])
    composable.highlightBlock(1)
    expect(scrollToAnchor).toHaveBeenCalledTimes(1)
  })

  it('does not scroll when scrollIntoView is false', async () => {
    const { composable, scrollToAnchor } = await setup(['First.', 'Second.'])
    composable.highlightBlock(1, false)
    expect(scrollToAnchor).not.toHaveBeenCalled()
  })

  it('returns false and highlights nothing for an out-of-range index', async () => {
    const { composable, overlayer } = await setup(['Only paragraph.'])
    expect(composable.highlightBlock(5)).toBe(false)
    expect(overlayer.add).not.toHaveBeenCalled()
  })

  it('removes the previous highlight before adding the new one', async () => {
    const { composable, overlayer } = await setup(['First.', 'Second.'])
    composable.highlightBlock(0)
    composable.highlightBlock(1)
    expect(overlayer.remove).toHaveBeenCalled()
  })
})

// ─── showResumeHighlightFromBlock ───────────────────────────────────────────

describe('showResumeHighlightFromBlock', () => {
  it('highlights the saved block when the chapter matches the current chapter', async () => {
    const { composable, overlayer } = await setup(['P0.', 'P1.', 'P2.'])
    const ok = composable.showResumeHighlightFromBlock(3, 2, 3)
    expect(ok).toBe(true)
    const highlightedRange = overlayer.add.mock.calls[0]![1] as Range
    expect(highlightedRange.toString().trim()).toBe('P2.')
  })

  it('does not highlight when the saved chapter differs from the current chapter', async () => {
    const { composable, overlayer } = await setup(['P0.', 'P1.'])
    expect(composable.showResumeHighlightFromBlock(5, 1, 3)).toBe(false)
    expect(overlayer.add).not.toHaveBeenCalled()
  })

  it('does not scroll the reader for the resume marker', async () => {
    const { composable, scrollToAnchor } = await setup(['P0.', 'P1.'])
    composable.showResumeHighlightFromBlock(0, 1, 0)
    expect(scrollToAnchor).not.toHaveBeenCalled()
  })
})

// ─── clearHighlight / clearFoliateSource ────────────────────────────────────

describe('clearHighlight', () => {
  it('removes the TTS highlight from the overlayer', async () => {
    const { composable, overlayer } = await setup(['P0.'])
    composable.highlightBlock(0)
    overlayer.remove.mockClear()
    composable.clearHighlight()
    expect(overlayer.remove).toHaveBeenCalled()
  })

  it('clearFoliateSource resets so getBlockIndexForRange returns -1', async () => {
    const { composable, doc } = await setup(['P0.', 'P1.'])
    composable.clearFoliateSource()
    expect(composable.getBlockIndexForRange(rangeInParagraph(doc, 1))).toBe(-1)
  })
})
