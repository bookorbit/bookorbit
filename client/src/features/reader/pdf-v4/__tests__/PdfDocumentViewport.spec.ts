import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'

const links = vi.hoisted(() => [] as { id: string; target: { kind: string; uri?: string } }[])

const layerStub = (name: string) => defineComponent({ name, setup: () => () => h('div', { 'data-testid': name }) })

vi.mock('@embedpdf/vue/stage', () => ({
  Stage: defineComponent({
    inheritAttrs: false,
    setup(_, { attrs, slots }) {
      return () =>
        h('div', { ...attrs, 'data-testid': 'stage' }, [
          slots.page?.({ page: { pageIndex: 0 } }),
          h('div', { 'data-testid': 'overlay' }, slots.overlay?.()),
        ])
    },
  }),
  Scrollbar: layerStub('Scrollbar'),
}))
vi.mock('@embedpdf/vue/render', () => ({ RenderLayer: layerStub('RenderLayer') }))
vi.mock('@embedpdf/vue/search', () => ({ SearchLayer: layerStub('SearchLayer') }))
vi.mock('@embedpdf/vue/selection', () => ({
  SelectionClipboard: layerStub('SelectionClipboard'),
  SelectionHandles: layerStub('SelectionHandles'),
  SelectionLayer: layerStub('SelectionLayer'),
}))
vi.mock('@embedpdf/vue/link', () => ({
  LinkLayer: defineComponent({
    name: 'LinkLayer',
    setup(_, { slots }) {
      const native = layerStub('NativeLink')
      return () =>
        h(
          'div',
          { 'data-testid': 'LinkLayer' },
          links.map((link) => slots.link?.({ link, native })),
        )
    },
  }),
}))
vi.mock('../components/PdfHighlightLayer.vue', () => ({ default: layerStub('PdfHighlightLayer') }))
vi.mock('../components/PdfExternalLink.vue', () => ({
  default: defineComponent({
    name: 'PdfExternalLink',
    props: { link: { type: Object, required: true }, url: { type: URL, required: true } },
    emits: ['open'],
    setup:
      (props, { emit }) =>
      () =>
        h('button', { 'data-testid': 'external-link', onClick: () => emit('open', props.url) }, props.url.href),
  }),
}))

const { default: PdfDocumentViewport } = await import('../components/PdfDocumentViewport.vue')

describe('PdfDocumentViewport', () => {
  it('stacks the page layers with app highlights under search and selection', () => {
    links.length = 0
    const wrapper = mount(PdfDocumentViewport, { props: { annotations: [] } })

    const order = wrapper
      .get('[data-testid="stage"]')
      .findAll('[data-testid]')
      .map((element) => element.attributes('data-testid'))
    expect(order.slice(0, 5)).toEqual(['RenderLayer', 'PdfHighlightLayer', 'SearchLayer', 'SelectionLayer', 'LinkLayer'])
  })

  it('routes web links through the confirmation and leaves in-document links to the viewer', async () => {
    links.splice(
      0,
      links.length,
      { id: 'web', target: { kind: 'uri', uri: 'https://example.com/a' } },
      { id: 'script', target: { kind: 'uri', uri: 'javascript:alert(1)' } },
      { id: 'page', target: { kind: 'goto' } },
    )
    const wrapper = mount(PdfDocumentViewport, { props: { annotations: [] } })

    expect(wrapper.findAll('[data-testid="external-link"]')).toHaveLength(1)
    expect(wrapper.findAll('[data-testid="NativeLink"]')).toHaveLength(2)

    await wrapper.get('[data-testid="external-link"]').trigger('click')
    expect(wrapper.emitted('externalLink')?.[0]?.[0]).toBeInstanceOf(URL)
  })

  it('renders the caller overlay above the Stage', () => {
    links.length = 0
    const wrapper = mount(PdfDocumentViewport, { props: { annotations: [] }, slots: { overlay: '<div data-testid="caller-overlay" />' } })

    expect(wrapper.get('[data-testid="overlay"]').find('[data-testid="caller-overlay"]').exists()).toBe(true)
  })
})
