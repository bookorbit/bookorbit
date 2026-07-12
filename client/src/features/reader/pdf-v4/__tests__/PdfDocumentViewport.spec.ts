import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import PdfDocumentViewport from '../components/PdfDocumentViewport.vue'

const passthroughStub = (testId: string) =>
  defineComponent({
    inheritAttrs: false,
    setup(_, { attrs, slots }) {
      return () => h('div', { ...attrs, 'data-testid': testId }, slots.default?.())
    },
  })

const layerStub = (testId: string) =>
  defineComponent({
    inheritAttrs: false,
    setup(_, { attrs }) {
      return () => h('div', { ...attrs, 'data-testid': testId })
    },
  })

describe('PdfDocumentViewport', () => {
  it('keeps rotation outside the sized pointer layer so page backdrops fill at every zoom', () => {
    const wrapper = mount(PdfDocumentViewport, {
      props: { documentId: 'doc-1' },
      global: {
        stubs: {
          GlobalPointerProvider: passthroughStub('global-pointer'),
          Viewport: passthroughStub('viewport'),
          ZoomGestureWrapper: passthroughStub('zoom-wrapper'),
          Scroller: defineComponent({
            setup(_, { slots }) {
              return () => h('div', { 'data-testid': 'scroller' }, slots.default?.({ page: { pageIndex: 3 } }))
            },
          }),
          Rotate: passthroughStub('rotate'),
          PagePointerProvider: passthroughStub('page-pointer'),
          RenderLayer: layerStub('render'),
          TilingLayer: layerStub('tiling'),
          SearchLayer: layerStub('search'),
          SelectionLayer: layerStub('selection'),
          AnnotationLayer: layerStub('annotation'),
        },
      },
    })

    const rotate = wrapper.get('[data-testid="rotate"]')
    const pointer = rotate.get('[data-testid="page-pointer"]')

    expect(pointer.get('[data-testid="render"]').attributes('scale')).toBe('0.5')
    expect(pointer.find('[data-testid="tiling"]').exists()).toBe(true)
    expect(pointer.get('[data-testid="search"]').attributes('highlight-color')).toContain('var(--primary)')
  })
})
