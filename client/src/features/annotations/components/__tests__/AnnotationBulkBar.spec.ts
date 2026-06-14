import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { ANNOTATION_HIGHLIGHT_COLORS } from '@bookorbit/types'
import AnnotationBulkBar from '../AnnotationBulkBar.vue'

const stubs = {
  Tooltip: { template: '<div><slot /></div>' },
  TooltipTrigger: { template: '<div><slot /></div>' },
  TooltipContent: { template: '<div><slot /></div>' },
}

function mountBar(props: Record<string, unknown> = {}) {
  return mount(AnnotationBulkBar, {
    props: { count: 2, allVisibleSelected: false, ...props },
    global: { stubs },
  })
}

describe('AnnotationBulkBar', () => {
  it('renders the selected count', () => {
    expect(mountBar({ count: 5 }).text()).toContain('5 selected')
  })

  it('labels the select-page toggle by visibility state', () => {
    expect(mountBar({ allVisibleSelected: false }).text()).toContain('Select page')
    expect(mountBar({ allVisibleSelected: true }).text()).toContain('Page selected')
  })

  it('emits selectPage and clear', async () => {
    const wrapper = mountBar()
    const buttons = wrapper.findAll('button')
    await buttons.find((button) => button.text().includes('Select page'))!.trigger('click')
    await buttons.find((button) => button.text() === 'Clear')!.trigger('click')
    expect(wrapper.emitted('selectPage')).toBeTruthy()
    expect(wrapper.emitted('clear')).toBeTruthy()
  })

  it('hides the restyle controls by default', () => {
    expect(mountBar().find('[aria-label="Recolor to Yellow"]').exists()).toBe(false)
  })

  it('emits recolor and restyle when showRestyle is enabled', async () => {
    const wrapper = mountBar({ showRestyle: true })
    await wrapper.get('[aria-label="Recolor to Yellow"]').trigger('click')
    expect(wrapper.emitted('recolor')!.slice(-1)[0]).toEqual([ANNOTATION_HIGHLIGHT_COLORS[0]!.hex])

    await wrapper.get('[aria-label="Restyle to Underline"]').trigger('click')
    expect(wrapper.emitted('restyle')!.slice(-1)[0]).toEqual(['underline'])
  })
})
