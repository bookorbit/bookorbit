import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
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

describe('JumpRail', () => {
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
})
