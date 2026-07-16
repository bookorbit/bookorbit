import { defineComponent, h, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { ScrollScope } from '@embedpdf/plugin-scroll'
import { usePdfPagination } from '../composables/usePdfPagination'

describe('usePdfPagination', () => {
  it('stays stable while EmbedPDF unloads the document scope', () => {
    const scroll = ref({
      getSpreadPagesWithRotatedSize() {
        throw new Error('Document doc-1 not loaded')
      },
      scrollToPage() {
        throw new Error('Document doc-1 not loaded')
      },
    } as unknown as Readonly<ScrollScope>)
    let pagination!: ReturnType<typeof usePdfPagination>

    const wrapper = mount(
      defineComponent({
        setup() {
          pagination = usePdfPagination({
            mode: ref('page'),
            scrollState: ref({ currentPage: 20, totalPages: 240 }),
            scroll,
            onActivity: () => {},
          })
          return () => h('div')
        },
      }),
    )

    expect(pagination.pageRange.value).toEqual({ start: 20, end: 20 })
    expect(() => pagination.goToPage(21)).not.toThrow()
    expect(() => pagination.nextPage()).not.toThrow()

    wrapper.unmount()
  })
})
