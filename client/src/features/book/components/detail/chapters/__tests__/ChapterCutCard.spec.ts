import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { setI18nLocale } from '@/i18n'
import type { WaveformView } from '@/features/book/composables/useChapterWaveform'
import ChapterCutCard from '../ChapterCutCard.vue'

const view: WaveformView = {
  waveform: { fromMs: 53_400, toMs: 67_400, peaks: [0.2, 0.6, 0.05, 0.8], failed: false },
  pauses: [{ startMs: 59_000, endMs: 60_700 }],
}

type CardProps = InstanceType<typeof ChapterCutCard>['$props']

const rows = [
  { key: 'a', title: 'Opening', startMs: 0 },
  { key: 'b', title: 'Chapter 02', startMs: 1_000 },
  { key: 'c', title: 'Chapter 03', startMs: 60_400 },
  { key: 'd', title: 'Chapter 04', startMs: 120_000 },
]

const baseProps = {
  rows,
  activeIndex: 2,
  totalDurationMs: 180_000,
  issuesByKey: new Map(),
  savedStartMs: 60_000,
  waveform: { view, loading: false, failed: false },
  minStartMs: 2_000,
  maxStartMs: 119_000,
  snap: { state: 'available', targetMs: 60_400 + 250 },
  snapping: false,
  snapRadiusMs: 5_000,
  positionMs: 60_400,
  isPlaying: false,
  playerLoading: false,
  playerError: null,
} satisfies CardProps

let wrapper: VueWrapper | null = null

function mountCard(overrides: Partial<CardProps> = {}) {
  wrapper = mount(ChapterCutCard, { props: { ...baseProps, ...overrides } })
  return wrapper
}

function button(name: string | RegExp) {
  const found = wrapper!
    .findAll('button')
    .find((candidate) => (typeof name === 'string' ? candidate.text().includes(name) : name.test(candidate.text())))
  if (!found) throw new Error(`no button "${String(name)}"`)
  return found
}

beforeEach(async () => {
  await setI18nLocale('en')
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('ChapterCutCard', () => {
  it('has no cut to move on the first chapter, says so, and still plays', () => {
    const card = mountCard({ activeIndex: 0 })

    expect(card.get('h3').text()).toBe('Start of the book')
    expect(card.text()).toContain('The first chapter always starts at 0:00')
    expect(card.find('[role="slider"][aria-label="Chapter start in the audio"]').exists()).toBe(false)
    expect(card.find('[aria-label="Play preview"]').exists()).toBe(true)
    expect(card.get('[aria-label="Previous cut"]').attributes('disabled')).toBeDefined()
  })

  it('names both chapters, counts the cut, and flags the time and how far it moved since the last save', () => {
    const card = mountCard()

    expect(card.get('section').attributes('aria-label')).toBe('Cut between Chapter 02 and Chapter 03')
    expect(card.get('h3 + span').text()).toBe('2 of 3')
    expect(card.text()).toContain('Ends')
    expect(card.text()).toContain('Chapter 02')
    expect(card.text()).toContain('Starts')
    expect(card.get('.flag').text()).toContain('1:00.400')
    expect(card.get('.flag').text()).toContain('+0.40s')
  })

  it('steps to the cut either side', async () => {
    const card = mountCard({ activeIndex: 3 })

    await card.get('[aria-label="Previous cut"]').trigger('click')

    expect(card.get('[aria-label="Next cut"]').attributes('disabled')).toBeDefined()
    expect(card.emitted('step')).toEqual([[-1]])
  })

  it('says what Snap will do before it is pressed', async () => {
    const card = mountCard()

    await button('Snap to pause').trigger('click')

    expect(button('Snap to pause').text()).toContain('+0.25s')
    expect(card.emitted('snap')).toHaveLength(1)
  })

  it.each([
    [{ state: 'on', targetMs: 60_400 }, 'On a pause'],
    [{ state: 'none', targetMs: null }, 'No pause within 5 seconds'],
  ] as const)('reports %o instead of offering a snap', (snap, text) => {
    const card = mountCard({ snap })

    expect(card.text()).toContain(text)
    expect(card.findAll('button').some((candidate) => candidate.text().includes('Snap to pause'))).toBe(false)
  })

  it('nudges by the labelled step, ten times further with Shift', async () => {
    const card = mountCard()

    await card.get('[aria-label="Move the start forward a tenth of a second"]').trigger('click')
    await card.get('[aria-label="Move the start back one second"]').trigger('click', { shiftKey: true })

    expect(card.emitted('nudge')).toEqual([[100], [-10_000]])
    expect(card.get('[aria-label="Move the start forward a tenth of a second"]').text()).toBe('+0.1s')
  })

  it('offers two play controls, and both read as stop while anything plays', async () => {
    const card = mountCard()

    await card.get('[aria-label="Play preview"]').trigger('click')
    await button('Play across the cut').trigger('click')
    await card.setProps({ isPlaying: true })

    expect(card.find('[aria-label="Pause preview"]').exists()).toBe(true)
    expect(button(/^Stop$/).attributes('title')).toBe('Stop playing (P)')
    await button(/^Stop$/).trigger('click')
    expect(card.emitted('toggle')).toHaveLength(1)
    expect(card.emitted('playCut')).toHaveLength(2)
  })

  it('moves the cut to the playhead only from inside the two chapters it divides, and says why not', async () => {
    const card = mountCard({ positionMs: 60_400 })
    expect(button('Move cut here').attributes('disabled')).toBeDefined()

    await card.setProps({ positionMs: 130_000 })
    expect(button('Move cut here').attributes('disabled')).toBeDefined()
    expect(card.text()).toContain('Put the playhead inside Chapter 02 or Chapter 03 to move this cut there.')

    await card.setProps({ positionMs: 61_000 })
    await button('Move cut here').trigger('click')
    await button('New chapter here').trigger('click')
    expect(card.emitted('moveCutHere')).toHaveLength(1)
    expect(card.emitted('newChapterHere')).toHaveLength(1)
    expect(card.text()).not.toContain('Put the playhead inside')
  })

  it('removes the cut and says what joins what', async () => {
    const card = mountCard()

    await button('Remove cut').trigger('click')

    expect(card.emitted('removeCut')).toHaveLength(1)
    expect(card.text()).toContain('Chapter 03 joins Chapter 02')
  })

  it('offers the way back to the cut once a paused playhead has paged away from it', async () => {
    const away: WaveformView = { waveform: { fromMs: 90_000, toMs: 104_000, peaks: [0.1, 0.2], failed: false }, pauses: [] }
    const card = mountCard({ waveform: { view: away, loading: false, failed: false }, positionMs: 95_000 })

    await button('Back to the cut').trigger('click')
    expect(card.emitted('backToCut')).toHaveLength(1)

    await card.setProps({ isPlaying: true })
    expect(card.findAll('button').some((candidate) => candidate.text().includes('Back to the cut'))).toBe(false)
  })

  it('skips fifteen seconds either way and names the chapter under the playhead', async () => {
    const card = mountCard({ positionMs: 125_000 })

    await card.get('[aria-label="Back 15 seconds"]').trigger('click')
    await card.get('[aria-label="Forward 15 seconds"]').trigger('click')

    expect(card.emitted('skip')).toEqual([[-15_000], [15_000]])
    expect(card.text()).toContain('2:05.000')
    expect(card.text()).toContain('Chapter 04')
  })
})
