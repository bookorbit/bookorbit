import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import MediaScrubber from '../MediaScrubber.vue'
import type { MediaScrubberMarker } from '../types'

const RAIL_WIDTH = 200

/** Test Utils builds pointer events as MouseEvent, whose clientX is read-only, so the event is constructed directly. */
async function firePointer(rail: { element: Element }, type: string, clientX = 0) {
  rail.element.dispatchEvent(new PointerEvent(type, { clientX, pointerId: 1, bubbles: true, cancelable: true }))
  await nextTick()
}

function mountScrubber(props: Partial<InstanceType<typeof MediaScrubber>['$props']> = {}) {
  const wrapper = mount(MediaScrubber, {
    props: { current: 0, duration: 200, ariaLabel: 'Episode position', ...props },
  })
  const rail = wrapper.get('[role="slider"]')
  // jsdom lays nothing out, so the rail geometry the pointer maths reads has to be stood up.
  vi.spyOn(rail.element, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: RAIL_WIDTH,
    bottom: 44,
    width: RAIL_WIDTH,
    height: 44,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect)
  return { wrapper, rail }
}

describe('MediaScrubber pointer scrubbing', () => {
  it('emits exactly one seek for a completed drag', async () => {
    const { wrapper, rail } = mountScrubber()

    await firePointer(rail, 'pointerdown', 20)
    await firePointer(rail, 'pointermove', 60)
    await firePointer(rail, 'pointermove', 150)
    await firePointer(rail, 'pointerup', 150)

    expect(wrapper.emitted('seek')).toEqual([[150]])
    expect(wrapper.emitted('scrubStart')).toHaveLength(1)
    expect(wrapper.emitted('scrubEnd')).toHaveLength(1)
  })

  it('previews the drag position without waiting for the parent to move', async () => {
    const { wrapper, rail } = mountScrubber({ current: 0 })

    await firePointer(rail, 'pointerdown', 100)

    expect(wrapper.get('[data-testid="media-scrubber-thumb"]').attributes('style')).toContain('left: 50%')
    expect(wrapper.get('[data-testid="media-scrubber-thumb"]').classes()).toContain('size-5')
  })

  it('abandons the drag without seeking when the pointer is cancelled', async () => {
    const { wrapper, rail } = mountScrubber()

    await firePointer(rail, 'pointerdown', 100)
    await firePointer(rail, 'pointercancel')

    expect(wrapper.emitted('seek')).toBeUndefined()
    expect(wrapper.emitted('scrubEnd')).toHaveLength(1)
  })

  it('emits continuously while dragging when the caller needs live feedback', async () => {
    const { wrapper, rail } = mountScrubber({ continuous: true, duration: 1, step: 0.05 })

    await firePointer(rail, 'pointerdown', 0)
    await firePointer(rail, 'pointermove', 100)
    await firePointer(rail, 'pointerup', 100)

    expect(wrapper.emitted('seek')).toEqual([[0], [0.5], [0.5]])
  })
})

describe('MediaScrubber keyboard operation', () => {
  it('steps by the arrow, page, and jump keys', async () => {
    const { wrapper, rail } = mountScrubber({ current: 100 })

    for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']) {
      await rail.trigger('keydown', { key })
    }

    expect(wrapper.emitted('seek')).toEqual([[105], [95], [105], [95], [130], [70], [0], [200]])
  })

  it('clamps steps to the rail bounds', async () => {
    const nearEnd = mountScrubber({ current: 198 })
    const nearStart = mountScrubber({ current: 10 })

    await nearEnd.rail.trigger('keydown', { key: 'ArrowRight' })
    await nearStart.rail.trigger('keydown', { key: 'PageDown' })

    expect(nearEnd.wrapper.emitted('seek')).toEqual([[200]])
    expect(nearStart.wrapper.emitted('seek')).toEqual([[0]])
  })

  it('ignores keys it does not own', async () => {
    const { wrapper, rail } = mountScrubber({ current: 100 })

    await rail.trigger('keydown', { key: 'Tab' })

    expect(wrapper.emitted('seek')).toBeUndefined()
  })
})

describe('MediaScrubber rendering', () => {
  it('renders chapter and bookmark markers, skipping the rail ends', () => {
    const markers: MediaScrubberMarker[] = [
      { position: 0, kind: 'chapter' },
      { position: 50, kind: 'chapter' },
      { position: 100, kind: 'chapter', active: true },
      { position: 150, kind: 'bookmark' },
      { position: 200, kind: 'chapter' },
    ]
    const { wrapper } = mountScrubber({ markers })

    const rendered = wrapper.findAll('[data-testid="media-scrubber-marker"]')
    expect(rendered).toHaveLength(3)
    expect(rendered[0]!.classes()).toContain('bg-foreground/35')
    expect(rendered[0]!.attributes('style')).toContain('left: 25%')
    expect(rendered[1]!.classes()).toContain('bg-primary')
    expect(rendered[2]!.classes()).toContain('bg-warning')
    expect(rendered[2]!.attributes('data-kind')).toBe('bookmark')
  })

  it('shades buffered ranges and drops empty ones', () => {
    const { wrapper } = mountScrubber({
      buffered: [
        { start: 0, end: 50 },
        { start: 120, end: 120 },
        { start: 150, end: 400 },
      ],
    })

    const segments = wrapper.findAll('[data-testid="media-scrubber-buffered"]')
    expect(segments).toHaveLength(2)
    expect(segments[0]!.attributes('style')).toContain('width: 25%')
    expect(segments[1]!.attributes('style')).toContain('left: 75%')
    expect(segments[1]!.attributes('style')).toContain('width: 25%')
  })

  it('exposes slider semantics with the caller-composed value text', () => {
    const { rail } = mountScrubber({ current: 90, ariaValueText: '1:30 elapsed of 3:20' })

    expect(rail.attributes('aria-valuemin')).toBe('0')
    expect(rail.attributes('aria-valuemax')).toBe('200')
    expect(rail.attributes('aria-valuenow')).toBe('90')
    expect(rail.attributes('aria-valuetext')).toBe('1:30 elapsed of 3:20')
    expect(rail.attributes('aria-label')).toBe('Episode position')
    expect(rail.attributes('tabindex')).toBe('0')
    expect(rail.attributes('aria-disabled')).toBeUndefined()
  })

  it('shows the caller tooltip for the hovered position', async () => {
    const tooltip = vi.fn<(seconds: number) => { primary: string; secondary: string }>((seconds) => ({
      primary: `${seconds}s`,
      secondary: 'Chapter two',
    }))
    const { wrapper, rail } = mountScrubber({ tooltip })

    await firePointer(rail, 'pointermove', 50)

    expect(tooltip).toHaveBeenCalledWith(50)
    const bubble = wrapper.get('[data-testid="media-scrubber-tooltip"]')
    expect(bubble.text()).toContain('50s')
    expect(bubble.text()).toContain('Chapter two')

    await firePointer(rail, 'pointerleave')
    expect(wrapper.find('[data-testid="media-scrubber-tooltip"]').exists()).toBe(false)
  })
})

describe('MediaScrubber inert states', () => {
  it('renders an indeterminate rail when the duration is unknown', async () => {
    const { wrapper, rail } = mountScrubber({ duration: 0 })

    expect(rail.attributes('aria-disabled')).toBe('true')
    expect(rail.attributes('tabindex')).toBe('-1')
    expect(wrapper.find('[data-testid="media-scrubber-thumb"]').exists()).toBe(false)

    await firePointer(rail, 'pointerdown', 100)
    await rail.trigger('keydown', { key: 'ArrowRight' })

    expect(wrapper.emitted('seek')).toBeUndefined()
    expect(wrapper.emitted('scrubStart')).toBeUndefined()
  })

  it('ignores interaction while disabled', async () => {
    const { wrapper, rail } = mountScrubber({ disabled: true })

    await firePointer(rail, 'pointerdown', 100)
    await rail.trigger('keydown', { key: 'End' })

    expect(rail.attributes('aria-disabled')).toBe('true')
    expect(wrapper.emitted('seek')).toBeUndefined()
  })
})
