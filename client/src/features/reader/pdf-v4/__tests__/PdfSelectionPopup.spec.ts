import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PdfSelectionPopup from '../components/PdfSelectionPopup.vue'

describe('PdfSelectionPopup', () => {
  it('exposes localized pressed state for color and style controls', async () => {
    const wrapper = mount(PdfSelectionPopup, {
      props: {
        visible: true,
        position: { x: 10, y: 10 },
        showBelow: true,
        selectedText: 'selected text',
        overlappingAnnotationId: null,
      },
      global: {
        stubs: {
          Tooltip: { template: '<div><slot /></div>' },
          TooltipTrigger: { template: '<div><slot /></div>' },
          TooltipContent: { template: '<div><slot /></div>' },
        },
      },
    })

    await wrapper.get('button[aria-label="Highlight"]').trigger('click')

    const yellow = wrapper.get('button[aria-label="Highlight color: Yellow"]')
    const underline = wrapper.get('button[aria-label="Highlight style: Underline"]')
    expect(yellow.attributes('aria-pressed')).toBe('true')
    expect(underline.attributes('aria-pressed')).toBe('false')

    await underline.trigger('click')
    expect(underline.attributes('aria-pressed')).toBe('true')
  })
})
