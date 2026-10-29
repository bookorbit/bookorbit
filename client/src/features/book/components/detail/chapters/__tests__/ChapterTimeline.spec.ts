import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { setI18nLocale } from '@/i18n'
import { toDraft } from '@/features/book/lib/chapter-edit'
import ChapterTimeline from '../ChapterTimeline.vue'

const rows = toDraft([
  { title: 'Opening', startMs: 0 },
  { title: 'One', startMs: 600_000 },
  { title: 'Two', startMs: 1_800_000 },
])

type TimelineProps = InstanceType<typeof ChapterTimeline>['$props']

let wrapper: VueWrapper | null = null

function mountTimeline(props: Partial<TimelineProps>) {
  wrapper = mount(ChapterTimeline, {
    props: { rows, totalDurationMs: 3_600_000, mode: 'listen', ...props } as TimelineProps,
    attachTo: document.body,
  })
  return wrapper
}

function tones(): string[] {
  return wrapper!.findAll('.segment').map((segment) => segment.classes().find((name) => name.startsWith('tone-'))!)
}

beforeEach(async () => {
  await setI18nLocale('en')
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('ChapterTimeline', () => {
  it('shows what has been heard while listening, as a picture rather than a control', () => {
    const timeline = mountTimeline({ listeningMs: 900_000 })

    const bar = timeline.get('[role="img"]')
    expect(bar.attributes('aria-label')).toBe('25% of the book listened')
    expect(tones()).toEqual(['tone-done', 'tone-heard', 'tone-base'])
    expect(timeline.find('[role="slider"]').exists()).toBe(false)
  })

  it('marks the chapter being edited and chapters with problems', () => {
    mountTimeline({
      mode: 'edit',
      activeKey: rows[2]!.key,
      issuesByKey: new Map([[rows[1]!.key, [{ key: rows[1]!.key, index: 1, code: 'tooShort', severity: 'warning' }]]]),
      playheadMs: 0,
    })

    expect(tones()).toEqual(['tone-base', 'tone-warning', 'tone-active'])
  })

  it('scrubs the playhead on release and steps it from the keyboard', async () => {
    const timeline = mountTimeline({ mode: 'edit', playheadMs: 600_000 })
    const slider = timeline.get('[role="slider"]')
    slider.element.getBoundingClientRect = () => ({ left: 0, width: 360, top: 0, height: 16, right: 360, bottom: 16, x: 0, y: 0, toJSON: () => ({}) })

    slider.element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 90, pointerId: 1 }))
    slider.element.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 180, pointerId: 1 }))
    await nextTick()
    expect(timeline.emitted('seek')).toBeUndefined()
    slider.element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 180, pointerId: 1 }))

    await slider.trigger('keydown', { key: 'ArrowRight' })
    await slider.trigger('keydown', { key: 'End' })

    expect(timeline.emitted('seek')).toEqual([[1_800_000], [605_000], [3_600_000]])
  })

  it('labels the hours under the bar', () => {
    const timeline = mountTimeline({})

    expect(timeline.get('.timeline-ticks').text()).toContain('0:00')
    expect(timeline.get('.timeline-ticks').text()).toContain('1:00:00')
  })
})
