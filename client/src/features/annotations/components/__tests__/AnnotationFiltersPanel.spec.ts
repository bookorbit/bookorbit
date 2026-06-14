import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { ANNOTATION_COLOR_FILTER_OPTIONS } from '@bookorbit/types'
import AnnotationFiltersPanel from '../AnnotationFiltersPanel.vue'

function mountPanel(props: Record<string, unknown> = {}) {
  return mount(AnnotationFiltersPanel, {
    props: { colors: [], dateFrom: '', dateTo: '', ...props },
  })
}

describe('AnnotationFiltersPanel', () => {
  it('renders one toggleable swatch per filterable color', () => {
    const swatches = mountPanel().findAll('button[aria-pressed]')
    expect(swatches).toHaveLength(ANNOTATION_COLOR_FILTER_OPTIONS.length)
  })

  it('adds a color to the selection when toggled on', async () => {
    const wrapper = mountPanel({ colors: [] })
    await wrapper.get('button[aria-label="Yellow"]').trigger('click')
    expect(wrapper.emitted('update:colors')!.slice(-1)[0]).toEqual([['#FACC15']])
  })

  it('removes a color from the selection when toggled off', async () => {
    const wrapper = mountPanel({ colors: ['#FACC15'] })
    expect(wrapper.get('button[aria-label="Yellow"]').attributes('aria-pressed')).toBe('true')
    await wrapper.get('button[aria-label="Yellow"]').trigger('click')
    expect(wrapper.emitted('update:colors')!.slice(-1)[0]).toEqual([[]])
  })

  it('updates and clears the date range', async () => {
    const wrapper = mountPanel({ dateFrom: '2026-01-01', dateTo: '2026-01-31' })
    const dateInputs = wrapper.findAll('input[type="date"]')
    await dateInputs[0]!.setValue('2026-02-01')
    expect(wrapper.emitted('update:dateFrom')!.slice(-1)[0]).toEqual(['2026-02-01'])
    await dateInputs[1]!.setValue('2026-02-28')
    expect(wrapper.emitted('update:dateTo')!.slice(-1)[0]).toEqual(['2026-02-28'])

    await wrapper.get('[aria-label="Clear date range"]').trigger('click')
    expect(wrapper.emitted('update:dateFrom')!.slice(-1)[0]).toEqual([''])
    expect(wrapper.emitted('update:dateTo')!.slice(-1)[0]).toEqual([''])
  })

  it('emits clearAll from the footer button', async () => {
    const wrapper = mountPanel()
    const clearAll = wrapper.findAll('button').find((button) => button.text() === 'Clear all')
    await clearAll!.trigger('click')
    expect(wrapper.emitted('clearAll')).toBeTruthy()
  })
})
