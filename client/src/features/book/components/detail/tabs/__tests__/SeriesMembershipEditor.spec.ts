import { mount } from '@vue/test-utils'
import { defineComponent, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditableSeriesMembership } from '../../../../composables/useMetadataEditor'
import SeriesMembershipEditor from '../SeriesMembershipEditor.vue'

function mountHost(initialMemberships: EditableSeriesMembership[] = []) {
  const Host = defineComponent({
    components: { SeriesMembershipEditor },
    setup() {
      const memberships = ref<EditableSeriesMembership[]>(initialMemberships)
      const searchFn = vi.fn<(query: string) => Promise<string[]>>().mockResolvedValue([])
      return { memberships, searchFn }
    },
    template: '<SeriesMembershipEditor v-model="memberships" :search-fn="searchFn" />',
  })

  const attachTo = document.createElement('div')
  document.body.appendChild(attachTo)

  return mount(Host, {
    attachTo,
    global: {
      stubs: {
        teleport: true,
      },
    },
  })
}

describe('SeriesMembershipEditor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('keeps the series name input focused while typing into an empty series row', async () => {
    const wrapper = mountHost()
    const input = wrapper.get<HTMLInputElement>('input[type="text"]')

    input.element.focus()
    await input.trigger('focus')
    expect(document.activeElement).toBe(input.element)

    await input.setValue('D')
    await nextTick()

    const updatedInput = wrapper.get<HTMLInputElement>('input[type="text"]')
    expect(updatedInput.element).toBe(input.element)
    expect(document.activeElement).toBe(input.element)

    await updatedInput.setValue('Dune')
    await nextTick()

    const finalInput = wrapper.get<HTMLInputElement>('input[type="text"]')
    expect(finalInput.element).toBe(input.element)
    expect(document.activeElement).toBe(input.element)
    expect((wrapper.vm as { memberships: EditableSeriesMembership[] }).memberships).toEqual([
      { seriesName: 'Dune', seriesIndex: null, expectedBookCount: null },
    ])
  })

  describe('series length', () => {
    function membershipsOf(wrapper: ReturnType<typeof mountHost>): EditableSeriesMembership[] {
      return (wrapper.vm as { memberships: EditableSeriesMembership[] }).memberships
    }

    function totalInput(wrapper: ReturnType<typeof mountHost>) {
      return wrapper.get<HTMLInputElement>('input[type="number"][min="1"]')
    }

    it('shows the stored series length', () => {
      const wrapper = mountHost([{ seriesName: 'Dune', seriesIndex: 1, expectedBookCount: 6 }])

      expect(totalInput(wrapper).element.value).toBe('6')
    })

    it('records a typed length as an integer', async () => {
      const wrapper = mountHost([{ seriesName: 'Dune', seriesIndex: 1, expectedBookCount: null }])

      await totalInput(wrapper).setValue('7')

      expect(membershipsOf(wrapper)[0]?.expectedBookCount).toBe(7)
    })

    it('clears the length when the field is emptied', async () => {
      const wrapper = mountHost([{ seriesName: 'Dune', seriesIndex: 1, expectedBookCount: 6 }])

      await totalInput(wrapper).setValue('')

      expect(membershipsOf(wrapper)[0]?.expectedBookCount).toBeNull()
    })

    it('treats an unparseable length as cleared rather than NaN', async () => {
      const wrapper = mountHost([{ seriesName: 'Dune', seriesIndex: 1, expectedBookCount: 6 }])

      await totalInput(wrapper).setValue('abc')

      expect(membershipsOf(wrapper)[0]?.expectedBookCount).toBeNull()
    })

    it('labels the length field for assistive technology, since the row has no visible labels', () => {
      const wrapper = mountHost([{ seriesName: 'Dune', seriesIndex: 1, expectedBookCount: 6 }])

      expect(totalInput(wrapper).attributes('aria-label')).toBe('Books in series')
    })

    it('keeps each row length independent', async () => {
      const wrapper = mountHost([
        { seriesName: 'Dune', seriesIndex: 1, expectedBookCount: 6 },
        { seriesName: 'Legends', seriesIndex: 2, expectedBookCount: null },
      ])

      const totals = wrapper.findAll<HTMLInputElement>('input[type="number"][min="1"]')
      await totals[1]!.setValue('3')

      expect(membershipsOf(wrapper).map((m) => m.expectedBookCount)).toEqual([6, 3])
    })
  })
})
