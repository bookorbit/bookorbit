import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { DictionaryResult } from '@bookorbit/types'

// Mock useDictionary before importing the component.
// Path is relative to this test file (components/__tests__/) so we need two levels up to reach composables/.
const mockLookup = vi.fn<() => Promise<DictionaryResult | null>>()
vi.mock('../../composables/useDictionary', () => ({
  useDictionary: () => ({ lookup: mockLookup }),
}))

// Mock Audio globally
const mockPlay = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
class MockAudio {
  src: string
  constructor(src: string) {
    this.src = src
  }
  play = mockPlay
}

function makeResult(overrides: Partial<DictionaryResult> = {}): DictionaryResult {
  return {
    word: 'hello',
    phonetic: '/həˈloʊ/',
    audioUrl: 'https://audio.example.com/hello.mp3',
    entries: [
      {
        partOfSpeech: 'noun',
        definitions: [
          { definition: 'An expression of greeting.', example: 'She said hello.' },
          { definition: 'A call to attract attention.', example: null },
        ],
        sourceWord: 'hello',
      },
      {
        partOfSpeech: 'verb',
        definitions: [{ definition: 'To greet with hello.', example: null }],
        sourceWord: 'hello',
      },
    ],
    provider: 'free-dictionary',
    ...overrides,
  }
}

/** A result shaped like a resolved inflection chain: candelabras -> candelabra -> candelabrum. */
function makeChainResult(): DictionaryResult {
  return {
    word: 'candelabras',
    phonetic: null,
    audioUrl: null,
    entries: [
      { partOfSpeech: 'Noun', definitions: [{ definition: 'plural of candelabra', example: null }], sourceWord: 'candelabras' },
      { partOfSpeech: 'Noun', definitions: [{ definition: 'A single candelabrum.', example: null }], sourceWord: 'candelabra' },
      { partOfSpeech: 'Noun', definitions: [{ definition: 'A candle holder with branches.', example: null }], sourceWord: 'candelabrum' },
    ],
    provider: 'wiktionary',
  }
}

function parseStylePx(style: string | undefined, prop: 'left' | 'top') {
  if (!style) return NaN
  const match = style.match(new RegExp(`${prop}:\\s*(-?\\d+(?:\\.\\d+)?)px`))
  return match ? Number(match[1]) : NaN
}

function clamp(value: number, min: number, max: number) {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

async function mountPopover(props = {}) {
  const { default: DictionaryPopover } = await import('../DictionaryPopover.vue')
  const wrapper = mount(DictionaryPopover, {
    props: {
      word: 'hello',
      position: { x: 200, y: 300, showBelow: false },
      lang: 'en',
      ...props,
    },
    attachTo: document.body,
    global: {
      stubs: {
        teleport: true,
      },
    },
  })
  return wrapper
}

describe('DictionaryPopover', () => {
  beforeEach(() => {
    vi.stubGlobal('Audio', MockAudio)
    mockLookup.mockReset()
    mockPlay.mockReset()
    mockPlay.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------

  it('renders a loading spinner while the lookup is in-flight', async () => {
    mockLookup.mockReturnValue(new Promise(() => {})) // never resolves
    const wrapper = await mountPopover()
    expect(wrapper.find('.animate-spin').exists()).toBe(true)
  })

  it('shows the word text during loading', async () => {
    mockLookup.mockReturnValue(new Promise(() => {}))
    const wrapper = await mountPopover({ word: 'ephemeral' })
    expect(wrapper.text()).toContain('ephemeral')
  })

  // -------------------------------------------------------------------------
  // Success state
  // -------------------------------------------------------------------------

  it('renders word and definitions after a successful lookup', async () => {
    mockLookup.mockResolvedValue(makeResult())
    const wrapper = await mountPopover()
    await flushPromises()

    expect(wrapper.text()).toContain('hello')
    expect(wrapper.text()).toContain('An expression of greeting.')
  })

  it('renders phonetic text when present', async () => {
    mockLookup.mockResolvedValue(makeResult({ phonetic: '/həˈloʊ/' }))
    const wrapper = await mountPopover()
    await flushPromises()
    expect(wrapper.text()).toContain('/həˈloʊ/')
  })

  it('does not render phonetic text when it is null', async () => {
    mockLookup.mockResolvedValue(makeResult({ phonetic: null }))
    const wrapper = await mountPopover()
    await flushPromises()
    expect(wrapper.text()).not.toContain('/həˈloʊ/')
  })

  it('renders audio button when audioUrl is present', async () => {
    mockLookup.mockResolvedValue(makeResult({ audioUrl: 'https://audio.example.com/hello.mp3' }))
    const wrapper = await mountPopover()
    await flushPromises()
    // Only button in success state is the audio button
    expect(wrapper.find('button').exists()).toBe(true)
  })

  it('does not render audio button when audioUrl is null', async () => {
    mockLookup.mockResolvedValue(makeResult({ audioUrl: null }))
    const wrapper = await mountPopover()
    await flushPromises()
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('groups definitions by part of speech', async () => {
    mockLookup.mockResolvedValue(makeResult())
    const wrapper = await mountPopover()
    await flushPromises()
    expect(wrapper.text()).toContain('noun')
    expect(wrapper.text()).toContain('verb')
  })

  it('renders all definition strings', async () => {
    mockLookup.mockResolvedValue(makeResult())
    const wrapper = await mountPopover()
    await flushPromises()
    expect(wrapper.text()).toContain('An expression of greeting.')
    expect(wrapper.text()).toContain('A call to attract attention.')
    expect(wrapper.text()).toContain('To greet with hello.')
  })

  // -------------------------------------------------------------------------
  // Resolved inflection chains (issue #1020)
  // -------------------------------------------------------------------------

  it('renders senses borrowed from a resolved lemma under their own heading', async () => {
    mockLookup.mockResolvedValue(makeChainResult())
    const wrapper = await mountPopover({ word: 'candelabras' })
    await flushPromises()

    // The looked-up word is already named in the popover header, so only the
    // borrowed groups need a heading of their own.
    const headings = wrapper.findAll('p.font-semibold').map((p) => p.text())
    expect(headings).toEqual(['candelabra', 'candelabrum'])
    expect(wrapper.text()).toContain('A candle holder with branches.')
  })

  it('does not add a lemma heading when every sense belongs to the looked-up word', async () => {
    mockLookup.mockResolvedValue(makeResult())
    const wrapper = await mountPopover()
    await flushPromises()

    // Only the result header itself is emphasised; no per-group heading is added.
    expect(wrapper.findAll('p.font-semibold')).toHaveLength(0)
  })

  it('keeps consecutive parts of speech for one word under a single heading', async () => {
    mockLookup.mockResolvedValue({
      word: 'leaves',
      phonetic: null,
      audioUrl: null,
      entries: [
        { partOfSpeech: 'Noun', definitions: [{ definition: 'plural of leaf', example: null }], sourceWord: 'leaves' },
        { partOfSpeech: 'Verb', definitions: [{ definition: 'third-person singular of leave', example: null }], sourceWord: 'leaves' },
        { partOfSpeech: 'Noun', definitions: [{ definition: 'A flattened plant organ.', example: null }], sourceWord: 'leaf' },
      ],
      provider: 'wiktionary',
    })
    const wrapper = await mountPopover({ word: 'leaves' })
    await flushPromises()

    // Both "leaves" blocks stay under the header with no repeated heading; only
    // the borrowed "leaf" block is labelled.
    expect(wrapper.findAll('p.font-semibold').map((p) => p.text())).toEqual(['leaf'])
    expect(wrapper.findAll('p.uppercase').map((p) => p.text())).toEqual(['Noun', 'Verb', 'Noun'])
  })

  // -------------------------------------------------------------------------
  // Audio playback
  // -------------------------------------------------------------------------

  it('plays audio when the audio button is clicked', async () => {
    mockLookup.mockResolvedValue(makeResult({ audioUrl: 'https://audio.example.com/hello.mp3' }))
    const wrapper = await mountPopover()
    await flushPromises()

    const audioBtn = wrapper.find('button')
    expect(audioBtn.exists()).toBe(true)
    await audioBtn.trigger('click')
    expect(mockPlay).toHaveBeenCalledTimes(1)
  })

  // -------------------------------------------------------------------------
  // Not-found state
  // -------------------------------------------------------------------------

  it('renders "No definition found" when lookup returns null', async () => {
    mockLookup.mockResolvedValue(null)
    const wrapper = await mountPopover()
    await flushPromises()
    expect(wrapper.text()).toContain('No definition found')
  })

  it('shows the word header in not-found state', async () => {
    mockLookup.mockResolvedValue(null)
    const wrapper = await mountPopover({ word: 'zzz' })
    await flushPromises()
    expect(wrapper.text()).toContain('zzz')
  })

  // -------------------------------------------------------------------------
  // Error state
  // -------------------------------------------------------------------------

  it('renders error message when lookup throws', async () => {
    mockLookup.mockRejectedValue(new Error('Network error'))
    const wrapper = await mountPopover()
    await flushPromises()
    expect(wrapper.text()).toContain('Could not load definition')
  })

  it('renders a retry button in error state', async () => {
    mockLookup.mockRejectedValue(new Error('Network error'))
    const wrapper = await mountPopover()
    await flushPromises()
    expect(wrapper.text()).toContain('Retry')
  })

  it('re-triggers lookup when retry button is clicked', async () => {
    mockLookup.mockRejectedValueOnce(new Error('first fail')).mockResolvedValueOnce(makeResult())
    const wrapper = await mountPopover()
    await flushPromises()

    const retryButton = wrapper.findAll('button').find((b) => b.text().includes('Retry'))
    expect(retryButton).toBeDefined()
    await retryButton!.trigger('click')
    await flushPromises()

    expect(mockLookup).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('An expression of greeting.')
  })

  // -------------------------------------------------------------------------
  // Close / dismiss behavior
  // -------------------------------------------------------------------------

  it('emits close when the backdrop is clicked', async () => {
    mockLookup.mockReturnValue(new Promise(() => {}))
    const wrapper = await mountPopover()

    const backdrop = wrapper.find('div.fixed.inset-0')
    expect(backdrop.exists()).toBe(true)
    await backdrop.trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  // -------------------------------------------------------------------------
  // Positioning
  // -------------------------------------------------------------------------

  it('positions above the anchor when showBelow is false and there is enough space', async () => {
    mockLookup.mockReturnValue(new Promise(() => {}))
    const wrapper = await mountPopover({
      position: { x: 300, y: 400, showBelow: false },
    })
    await wrapper.vm.$nextTick()

    const fixedDivs = wrapper.findAll('div.fixed')
    const popoverEl = fixedDivs[1]!
    expect(popoverEl).toBeDefined()

    const top = parseStylePx(popoverEl.attributes('style'), 'top')
    const expectedTop = clamp(400 - 220, 8, window.innerHeight - 220 - 8)
    expect(top).toBe(expectedTop)
  })

  it('positions below the anchor when showBelow is true', async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(120)
    mockLookup.mockReturnValue(new Promise(() => {}))
    const wrapper = await mountPopover({
      position: { x: 300, y: 200, showBelow: true },
    })
    await wrapper.vm.$nextTick()

    const fixedDivs = wrapper.findAll('div.fixed')
    const popoverEl = fixedDivs[1]!
    expect(popoverEl).toBeDefined()

    const top = parseStylePx(popoverEl.attributes('style'), 'top')
    const expectedTop = clamp(200, 8, window.innerHeight - 120 - 8)
    expect(top).toBe(expectedTop)
  })

  it('centers horizontally from position.x and keeps within viewport bounds', async () => {
    mockLookup.mockReturnValue(new Promise(() => {}))
    const wrapper = await mountPopover({
      position: { x: 456, y: 100, showBelow: true },
    })
    await wrapper.vm.$nextTick()

    const fixedDivs = wrapper.findAll('div.fixed')
    const popoverEl = fixedDivs[1]!
    expect(popoverEl).toBeDefined()

    const left = parseStylePx(popoverEl.attributes('style'), 'left')
    const expectedLeft = clamp(456 - 288 / 2, 8, window.innerWidth - 288 - 8)
    expect(left).toBe(expectedLeft)
  })

  it('clamps to top viewport edge when above placement would overflow', async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(240)
    mockLookup.mockReturnValue(new Promise(() => {}))
    const wrapper = await mountPopover({
      position: { x: 100, y: 40, showBelow: false },
    })
    await wrapper.vm.$nextTick()

    const fixedDivs = wrapper.findAll('div.fixed')
    const popoverEl = fixedDivs[1]!
    expect(popoverEl).toBeDefined()

    const top = parseStylePx(popoverEl.attributes('style'), 'top')
    expect(top).toBe(8)
  })

  it('renders a resizable popover container for bottom-right drag resizing', async () => {
    mockLookup.mockReturnValue(new Promise(() => {}))
    const wrapper = await mountPopover()
    const card = wrapper.find('div.bg-card')
    expect(card.exists()).toBe(true)
    expect(card.classes()).toContain('resize')
  })

  // -------------------------------------------------------------------------
  // Lookup called with correct args
  // -------------------------------------------------------------------------

  it('calls lookup with the provided word and lang on mount', async () => {
    mockLookup.mockResolvedValue(makeResult())
    await mountPopover({ word: 'ephemeral', lang: 'fr' })
    await flushPromises()
    expect(mockLookup).toHaveBeenCalledWith('ephemeral', 'fr')
  })
})
