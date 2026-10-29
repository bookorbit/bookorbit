import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { setI18nLocale } from '@/i18n'
import type { WaveformView } from '@/features/book/composables/useChapterWaveform'
import ChapterWaveformStrip from '../ChapterWaveformStrip.vue'

const view: WaveformView = {
  waveform: { fromMs: 50_000, toMs: 70_000, peaks: [0.04, 0.5, 0.01, 0.9], failed: false },
  pauses: [{ startMs: 58_000, endMs: 61_000 }],
}

type StripProps = InstanceType<typeof ChapterWaveformStrip>['$props']

const baseProps = {
  view,
  loading: false,
  failed: false,
  startMs: 60_000,
  minMs: 55_000,
  maxMs: 65_000,
  savedMs: null,
  snapMs: null,
  showSnap: false,
  boundaries: [0, 60_000, 90_000],
  playheadMs: null,
  disabled: false,
} satisfies StripProps

let wrapper: VueWrapper | null = null

function mountStrip(overrides: Partial<StripProps> = {}, slots: Record<string, string> = {}) {
  wrapper = mount(ChapterWaveformStrip, { props: { ...baseProps, ...overrides }, slots, attachTo: document.body })
  const slider = wrapper.get('[role="slider"]')
  // The track spans 200 px from x = 100, so each pixel is 100 ms of the 20 s window.
  slider.element.getBoundingClientRect = () => ({
    left: 100,
    width: 200,
    top: 0,
    height: 64,
    right: 300,
    bottom: 64,
    x: 100,
    y: 0,
    toJSON: () => ({}),
  })
  return { wrapper, slider }
}

async function press(slider: { element: Element }, type: string, init: PointerEventInit) {
  // Test utils cannot set inherited MouseEvent fields such as `button` on a PointerEvent.
  slider.element.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, ...init }))
  await nextTick()
}

function offsets(selector: string): string[] {
  return wrapper!.findAll(`[role="slider"] > ${selector}`).map((line) => (line.element as HTMLElement).style.left)
}

beforeEach(async () => {
  await setI18nLocale('en')
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('ChapterWaveformStrip', () => {
  it('describes the start as a slider bounded by its neighbours', () => {
    const { slider } = mountStrip({ startMs: 61_250 })

    expect(slider.attributes('aria-label')).toBe('Chapter start in the audio')
    expect(slider.attributes('aria-valuemin')).toBe('55000')
    expect(slider.attributes('aria-valuemax')).toBe('65000')
    expect(slider.attributes('aria-valuenow')).toBe('61250')
    expect(slider.attributes('aria-valuetext')).toBe('1:01.250')
    expect(slider.attributes('tabindex')).toBe('0')
    expect(slider.attributes('aria-disabled')).toBeUndefined()
  })

  it('draws the audio either side of the cut and a scale counted from the start', () => {
    const { wrapper } = mountStrip()

    expect(wrapper.findAll('svg path')).toHaveLength(2)
    expect(wrapper.text()).toContain('-10s')
    expect(wrapper.text()).toContain('0s')
    expect(wrapper.text()).toContain('+5s')
  })

  it('grabs the line and follows the drag', async () => {
    const { wrapper, slider } = mountStrip()

    await press(slider, 'pointerdown', { button: 0, clientX: 205, pointerId: 1 })
    await press(slider, 'pointermove', { clientX: 230, pointerId: 1 })
    await press(slider, 'pointermove', { clientX: 250, pointerId: 1 })

    expect(wrapper.emitted('move')).toEqual([[63_000], [65_000]])
    expect(wrapper.emitted('seek')).toBeUndefined()
    expect(wrapper.emitted('commit')).toBeUndefined()
  })

  it('moves the playhead, not the cut, on a press away from the line', async () => {
    const { wrapper, slider } = mountStrip()

    await press(slider, 'pointerdown', { button: 0, clientX: 130, pointerId: 1 })
    await press(slider, 'pointermove', { clientX: 150, pointerId: 1 })

    expect(wrapper.emitted('seek')).toEqual([[53_000]])
    expect(wrapper.emitted('move')).toBeUndefined()
  })

  it('keeps a drag between the neighbouring chapters', async () => {
    const { wrapper, slider } = mountStrip()

    await press(slider, 'pointerdown', { button: 0, clientX: 200, pointerId: 1 })
    await press(slider, 'pointermove', { clientX: 120, pointerId: 1 })
    await press(slider, 'pointermove', { clientX: 290, pointerId: 1 })
    await press(slider, 'pointermove', { clientX: 1_000, pointerId: 1 })
    await press(slider, 'pointermove', { clientX: -500, pointerId: 1 })

    expect(wrapper.emitted('move')).toEqual([[55_000], [65_000], [65_000], [55_000]])
  })

  it('commits when the pointer is released, and only once', async () => {
    const { wrapper, slider } = mountStrip()

    await press(slider, 'pointerdown', { button: 0, clientX: 200, pointerId: 1 })
    await press(slider, 'pointerup', { clientX: 200, pointerId: 1 })
    await press(slider, 'pointerup', { clientX: 200, pointerId: 1 })
    await press(slider, 'pointermove', { clientX: 210, pointerId: 1 })

    expect(wrapper.emitted('move')).toBeUndefined()
    expect(wrapper.emitted('commit')).toHaveLength(1)
  })

  it('commits a drag the browser cancels', async () => {
    const { wrapper, slider } = mountStrip()

    await press(slider, 'pointerdown', { button: 0, clientX: 202, pointerId: 1 })
    await press(slider, 'pointercancel', { pointerId: 1 })

    expect(wrapper.emitted('commit')).toHaveLength(1)
  })

  it('ignores a hover without a press and a secondary button', async () => {
    const { wrapper, slider } = mountStrip()

    await press(slider, 'pointermove', { clientX: 220, pointerId: 1 })
    await press(slider, 'pointerdown', { button: 2, clientX: 220, pointerId: 1 })
    await press(slider, 'pointerup', { pointerId: 1 })

    expect(wrapper.emitted('move')).toBeUndefined()
    expect(wrapper.emitted('seek')).toBeUndefined()
    expect(wrapper.emitted('commit')).toBeUndefined()
  })

  it.each([
    ['ArrowRight', false, 100],
    ['ArrowUp', false, 100],
    ['ArrowLeft', false, -100],
    ['ArrowDown', false, -100],
    ['PageUp', false, 1_000],
    ['PageDown', false, -1_000],
    ['ArrowRight', true, 1_000],
    ['ArrowLeft', true, -1_000],
    ['PageUp', true, 10_000],
    ['PageDown', true, -10_000],
  ])('nudges with %s (Shift %s) by %i ms', async (key, shiftKey, delta) => {
    const { wrapper, slider } = mountStrip()

    await slider.trigger('keydown', { key, shiftKey })

    expect(wrapper.emitted('nudge')).toEqual([[Math.max(-5000, Math.min(5000, delta))]])
  })

  it('leaves other keys to the page', async () => {
    const { wrapper, slider } = mountStrip()

    await slider.trigger('keydown', { key: 'Home' })
    await slider.trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('nudge')).toBeUndefined()
  })

  it('emits nothing while disabled', async () => {
    const { wrapper, slider } = mountStrip({ disabled: true, minMs: 0, maxMs: 0, startMs: 0 })

    await press(slider, 'pointerdown', { button: 0, clientX: 200, pointerId: 1 })
    await press(slider, 'pointermove', { clientX: 220, pointerId: 1 })
    await press(slider, 'pointerup', { pointerId: 1 })
    await slider.trigger('keydown', { key: 'ArrowRight' })

    expect(slider.attributes('tabindex')).toBe('-1')
    expect(slider.attributes('aria-disabled')).toBe('true')
    expect(wrapper.emitted('move')).toBeUndefined()
    expect(wrapper.emitted('commit')).toBeUndefined()
    expect(wrapper.emitted('nudge')).toBeUndefined()
  })

  it('announces loading before there is anything to draw', () => {
    const { wrapper } = mountStrip({ view: null, loading: true })

    expect(wrapper.get('[role="status"]').text()).toBe('Loading the audio around this start...')
    expect(wrapper.find('[role="slider"] > svg').exists()).toBe(false)
  })

  it('keeps the old waveform on screen while the next window loads', () => {
    const { wrapper } = mountStrip({ loading: true })

    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.findAll('svg path')).toHaveLength(2)
  })

  it('draws a window the playhead paged to in one colour, with book times and the way back to the cut', () => {
    const { wrapper } = mountStrip(
      { startMs: 20_000, minMs: 15_000, maxMs: 25_000, playheadMs: 55_000 },
      { flag: '<span class="probe">0:20.000</span>', away: '<template #away="{ side }"><span class="away">{{ side }}</span></template>' },
    )

    expect(wrapper.findAll('[role="slider"] > svg path')).toHaveLength(1)
    expect(wrapper.find('.probe').exists()).toBe(false)
    expect(wrapper.get('.away').text()).toBe('before')
    expect(wrapper.find('.blocked').exists()).toBe(false)
    expect(offsets('.cut')).toEqual([])
    expect(offsets('.playhead')).toEqual(['25%'])
    expect(wrapper.text()).toContain('0:55')
    expect(wrapper.text()).not.toContain('+5s')
  })

  it('points the way back forward when the cut lies after the window', () => {
    const { wrapper } = mountStrip(
      { startMs: 90_000, minMs: 85_000, maxMs: 95_000 },
      { away: '<template #away="{ side }"><span class="away">{{ side }}</span></template>' },
    )

    expect(wrapper.get('.away').text()).toBe('after')
    expect(wrapper.get('.away').element.parentElement!.className).toContain('right-0')
  })

  it('says so when the audio could not be drawn, and ignores presses', async () => {
    const { wrapper, slider } = mountStrip({ view: null, failed: true })

    expect(wrapper.text()).toContain('The audio here could not be drawn.')

    await press(slider, 'pointerdown', { button: 0, clientX: 200, pointerId: 1 })
    expect(wrapper.emitted('move')).toBeUndefined()
  })

  it('treats a waveform the server could not decode as failed', () => {
    const { wrapper } = mountStrip({ view: { waveform: { ...view.waveform, peaks: [], failed: true }, pauses: [] }, failed: true })

    expect(wrapper.text()).toContain('The audio here could not be drawn.')
    expect(wrapper.find('[role="slider"] > svg').exists()).toBe(false)
  })

  it('draws neighbouring boundaries only when they fall inside the window', () => {
    mountStrip({ boundaries: [40_000, 52_000, 60_000, 68_000, 90_000] })

    expect(offsets('.neighbour')).toEqual(['10%', '90%'])
  })

  it('draws the playhead when it is inside the window', () => {
    mountStrip({ boundaries: [], playheadMs: 55_000 })
    expect(offsets('.playhead')).toEqual(['25%'])

    wrapper!.unmount()
    mountStrip({ boundaries: [], playheadMs: 80_000 })
    expect(offsets('.playhead')).toEqual([])
  })

  it('keeps the saved start in view once the cut moves, and labels it', () => {
    const { wrapper } = mountStrip({ savedMs: 59_000 })

    const saved = wrapper.findAll('[role="slider"] > span').find((line) => line.text() === 'saved')
    expect((saved?.element as HTMLElement | undefined)?.style.left).toBe('45%')
  })

  it('shows where Snap would go only while asked to', () => {
    mountStrip({ snapMs: 62_000 })
    expect(offsets('.border-l-2')).toEqual([])

    wrapper!.unmount()
    mountStrip({ snapMs: 62_000, showSnap: true })
    expect(offsets('.border-l-2')).toEqual(['60%'])
  })

  it('pins the flag above the cut', () => {
    const { wrapper } = mountStrip({ startMs: 62_000 }, { flag: '<span class="probe">1:02.000</span>' })

    expect((wrapper.get('.probe').element.parentElement as HTMLElement).style.left).toBe('60%')
  })
})
