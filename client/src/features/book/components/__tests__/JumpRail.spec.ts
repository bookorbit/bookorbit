import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JumpBucket } from '@bookorbit/types'
import JumpRail from '../JumpRail.vue'

const LETTER_TEMPLATE = ['#', ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i))]

const LETTER_BUCKETS: JumpBucket[] = [
  { key: '#', label: '#', index: 0 },
  { key: 'A', label: 'A', index: 2 },
  { key: 'M', label: 'M', index: 30 },
]

function yearBuckets(count: number): JumpBucket[] {
  return Array.from({ length: count }, (_, i) => ({
    key: String(1950 + i),
    label: String(1950 + i),
    index: i * 3,
  }))
}

function mountRail(props: Partial<InstanceType<typeof JumpRail>['$props']> = {}) {
  return mount(JumpRail, {
    props: {
      visible: true,
      buckets: LETTER_BUCKETS,
      kind: 'letter' as const,
      activeKey: null,
      template: LETTER_TEMPLATE,
      ...props,
    },
  })
}

function preparePointerRail(wrapper: ReturnType<typeof mountRail>, height = 540) {
  const rail = wrapper.get('[data-testid="jump-rail"]').element as HTMLElement & {
    setPointerCapture: (pointerId: number) => void
  }
  rail.setPointerCapture = vi.fn<(pointerId: number) => void>()
  vi.spyOn(rail, 'getBoundingClientRect').mockReturnValue({
    top: 0,
    left: 0,
    right: 32,
    bottom: height,
    width: 32,
    height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
  return rail
}

async function firePointer(
  wrapper: ReturnType<typeof mountRail>,
  type: string,
  props: Partial<Pick<PointerEvent, 'clientY' | 'pointerId' | 'pointerType'>> = {},
) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  for (const [key, value] of Object.entries(props)) {
    Object.defineProperty(event, key, { configurable: true, value })
  }
  wrapper.get('[data-testid="jump-rail"]').element.dispatchEvent(event)
  await wrapper.vm.$nextTick()
}

describe('JumpRail', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders all 27 letter slots with unavailable letters disabled', () => {
    const wrapper = mountRail()

    const slots = wrapper.findAll('button')
    expect(slots).toHaveLength(27)

    const available = slots.filter((slot) => slot.attributes('disabled') === undefined)
    expect(available.map((slot) => slot.text())).toEqual(['#', 'A', 'M'])
  })

  it('renders letters in template order, supporting descending templates', () => {
    const wrapper = mountRail({ template: [...LETTER_TEMPLATE].reverse() })

    const labels = wrapper.findAll('button').map((slot) => slot.text())
    expect(labels[0]).toBe('Z')
    expect(labels[26]).toBe('#')
  })

  it('emits jump with the bucket when an available slot is clicked', async () => {
    const wrapper = mountRail()

    await wrapper.get('button[data-key="M"]').trigger('click')

    expect(wrapper.emitted('jump')).toEqual([[LETTER_BUCKETS[2]]])
  })

  it('does not emit jump for unavailable letters', async () => {
    const wrapper = mountRail()

    await wrapper.get('button[data-key="Q"]').trigger('click')

    expect(wrapper.emitted('jump')).toBeUndefined()
  })

  it('marks the active slot with aria-current', () => {
    const wrapper = mountRail({ activeKey: 'A' })

    expect(wrapper.get('button[data-key="A"]').attributes('aria-current')).toBe('true')
    expect(wrapper.get('button[data-key="M"]').attributes('aria-current')).toBeUndefined()
  })

  it('renders year buckets without a template', () => {
    const wrapper = mountRail({ kind: 'year' as const, buckets: yearBuckets(5), template: undefined })

    const labels = wrapper.findAll('button').map((slot) => slot.text())
    expect(labels).toEqual(['1950', '1951', '1952', '1953', '1954'])
  })

  it('thins large year sets to fit while keeping first and last', () => {
    const wrapper = mountRail({ kind: 'year' as const, buckets: yearBuckets(80), template: undefined })

    const labels = wrapper.findAll('button').map((slot) => slot.text())
    expect(labels.length).toBeLessThan(80)
    expect(labels[0]).toBe('1950')
    expect(labels[labels.length - 1]).toBe('2029')
  })

  it('renders nothing when not visible', () => {
    const wrapper = mountRail({ visible: false })

    expect(wrapper.find('[data-testid="jump-rail"]').exists()).toBe(false)
  })

  it('scrubs to the bucket under a pointer and captures the pointer', async () => {
    const wrapper = mountRail()
    const rail = preparePointerRail(wrapper)

    await firePointer(wrapper, 'pointerdown', {
      clientY: 42,
      pointerId: 11,
      pointerType: 'mouse',
    })

    expect(rail.setPointerCapture).toHaveBeenCalledWith(11)
    expect(wrapper.emitted('jump')).toEqual([[LETTER_BUCKETS[1]]])
  })

  it('uses the nearest available bucket when scrubbing over a disabled template slot', async () => {
    const vibrate = vi.fn<(pattern: VibratePattern) => boolean>()
    Object.defineProperty(window.navigator, 'vibrate', { configurable: true, value: vibrate })
    const wrapper = mountRail()
    preparePointerRail(wrapper)

    await firePointer(wrapper, 'pointerdown', {
      clientY: 330,
      pointerId: 12,
      pointerType: 'touch',
    })

    expect(wrapper.emitted('jump')).toEqual([[LETTER_BUCKETS[2]]])
    expect(vibrate).toHaveBeenCalledWith(5)
  })

  it('suppresses the click that follows a tap scrub on the same slot', async () => {
    const wrapper = mountRail()
    preparePointerRail(wrapper)

    await firePointer(wrapper, 'pointerdown', {
      clientY: 42,
      pointerId: 13,
      pointerType: 'touch',
    })
    await wrapper.get('button[data-key="A"]').trigger('click')

    expect(wrapper.emitted('jump')).toEqual([[LETTER_BUCKETS[1]]])
  })

  it('continues scrubbing on pointer move until the pointer ends', async () => {
    const wrapper = mountRail()
    preparePointerRail(wrapper)

    await firePointer(wrapper, 'pointerdown', { clientY: 2, pointerId: 14, pointerType: 'mouse' })
    await firePointer(wrapper, 'pointermove', { clientY: 250, pointerId: 14, pointerType: 'mouse' })
    await firePointer(wrapper, 'pointerup', { pointerId: 14, pointerType: 'mouse' })
    await firePointer(wrapper, 'pointermove', { clientY: 2, pointerId: 14, pointerType: 'mouse' })

    expect(wrapper.emitted('jump')).toEqual([[LETTER_BUCKETS[0]], [LETTER_BUCKETS[2]]])
  })

  it('tracks mouse hover only for available slots and clears it on leave', async () => {
    const wrapper = mountRail()
    preparePointerRail(wrapper)

    await firePointer(wrapper, 'pointerenter', { pointerType: 'mouse' })
    await firePointer(wrapper, 'pointermove', { clientY: 25, pointerType: 'mouse' })

    expect(wrapper.get('button[data-key="A"]').classes()).toContain('scale-[1.35]')

    await firePointer(wrapper, 'pointermove', { clientY: 82, pointerType: 'mouse' })
    expect(wrapper.get('button[data-key="A"]').classes()).not.toContain('scale-[1.35]')

    await firePointer(wrapper, 'pointerleave', { pointerType: 'mouse' })
    expect(wrapper.get('button[data-key="A"]').classes()).not.toContain('scale-[1.35]')
  })

  it('ignores pointer input when the rail has no measurable height', async () => {
    const wrapper = mountRail()
    preparePointerRail(wrapper, 0)

    await firePointer(wrapper, 'pointerdown', {
      clientY: 42,
      pointerId: 15,
      pointerType: 'mouse',
    })

    expect(wrapper.emitted('jump')).toBeUndefined()
  })

  it('ignores scrub input when a template has no available buckets', async () => {
    const wrapper = mountRail({ buckets: [] })
    preparePointerRail(wrapper)

    await firePointer(wrapper, 'pointerdown', {
      clientY: 42,
      pointerId: 16,
      pointerType: 'mouse',
    })

    expect(wrapper.emitted('jump')).toBeUndefined()
  })

  it('pulses open when the active key changes and closes after the pulse timer', async () => {
    vi.useFakeTimers()
    const wrapper = mountRail({ activeKey: null })

    await wrapper.setProps({ activeKey: 'A' })
    expect(wrapper.get('[data-testid="jump-rail"]').classes()).toContain('px-1.5')

    vi.advanceTimersByTime(900)
    await wrapper.vm.$nextTick()

    expect(wrapper.get('[data-testid="jump-rail"]').classes()).toContain('px-1')
  })

  it('clears a pending pulse timer on unmount', async () => {
    vi.useFakeTimers()
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    const wrapper = mountRail({ activeKey: null })

    await wrapper.setProps({ activeKey: 'A' })
    wrapper.unmount()

    expect(clearTimeoutSpy).toHaveBeenCalled()
  })
})
