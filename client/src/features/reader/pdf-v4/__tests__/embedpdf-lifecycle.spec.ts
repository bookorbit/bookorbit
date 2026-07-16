import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { EmbedPDF } from '@embedpdf/core/vue'
import type { PdfEngine } from '@embedpdf/models'

describe('patched EmbedPDF lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('registers teardown before asynchronous plugin initialization completes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const engine = {} as PdfEngine
    const Host = defineComponent({
      setup() {
        return () => h(EmbedPDF, { engine, plugins: [] }, () => h('div', 'reader'))
      },
    })

    const wrapper = mount(Host)
    await flushPromises()
    wrapper.unmount()

    expect(warn.mock.calls.flat().join(' ')).not.toContain('onBeforeUnmount is called when there is no active component instance')
  })
})
