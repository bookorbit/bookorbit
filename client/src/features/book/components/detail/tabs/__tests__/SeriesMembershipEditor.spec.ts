import { mount } from '@vue/test-utils'
import { defineComponent, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditableSeriesMembership } from '../../../../composables/useMetadataEditor'
import SeriesMembershipEditor from '../SeriesMembershipEditor.vue'

const passthrough = { template: '<div><slot /></div>' }

/** The menu's own open and focus handling belongs to reka; these specs only need its items. */
const menuStubs = {
  DropdownMenu: passthrough,
  DropdownMenuTrigger: passthrough,
  DropdownMenuContent: passthrough,
  DropdownMenuRadioGroup: {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: `<div class="radio-group" :data-current="modelValue" @click="$emit('update:modelValue', $event.target.closest('[data-value]').dataset.value)"><slot /></div>`,
  },
  DropdownMenuRadioItem: { props: ['value'], template: '<button type="button" class="radio-item" :data-value="value"><slot /></button>' },
}

function mountHost(initialMemberships: EditableSeriesMembership[] = [], options: { unitEditable?: boolean; disabled?: boolean } = {}) {
  const Host = defineComponent({
    components: { SeriesMembershipEditor },
    setup() {
      const memberships = ref<EditableSeriesMembership[]>(initialMemberships)
      const searchFn = vi.fn<(query: string) => Promise<string[]>>().mockResolvedValue([])
      return { memberships, searchFn, unitEditable: options.unitEditable ?? false, disabled: options.disabled ?? false }
    },
    template: '<SeriesMembershipEditor v-model="memberships" :search-fn="searchFn" :unit-editable="unitEditable" :disabled="disabled" />',
  })

  const attachTo = document.createElement('div')
  document.body.appendChild(attachTo)

  return mount(Host, {
    attachTo,
    global: {
      stubs: {
        teleport: true,
        ...(options.unitEditable ? menuStubs : {}),
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

  it('preserves a trailing zero while the series index is typed sequentially', async () => {
    const wrapper = mountHost([{ seriesName: 'Dune', seriesIndex: null, expectedBookCount: null }])

    for (const character of '5.10') {
      const input = wrapper.get<HTMLInputElement>('input[aria-label="Position in series"]')
      input.element.value += character
      await input.trigger('input')
      await nextTick()
    }

    const input = wrapper.get<HTMLInputElement>('input[aria-label="Position in series"]')
    expect(input.element.value).toBe('5.10')
    expect((wrapper.vm as { memberships: EditableSeriesMembership[] }).memberships[0]?.seriesIndex).toBe('5.10')
  })

  it('retains malformed text and exposes a validation error', async () => {
    const wrapper = mountHost([{ seriesName: 'Dune', seriesIndex: null, expectedBookCount: null }])
    const input = wrapper.get<HTMLInputElement>('input[aria-label="Position in series"]')

    await input.setValue('1.2.3')

    expect(input.attributes('aria-invalid')).toBe('true')
    expect(wrapper.get('[role="alert"]').text()).toContain('at most one decimal point')
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
      const wrapper = mountHost([{ seriesName: 'Dune', seriesIndex: '1', expectedBookCount: 6 }])

      expect(totalInput(wrapper).element.value).toBe('6')
    })

    it('records a typed length as an integer', async () => {
      const wrapper = mountHost([{ seriesName: 'Dune', seriesIndex: '1', expectedBookCount: null }])

      await totalInput(wrapper).setValue('7')

      expect(membershipsOf(wrapper)[0]?.expectedBookCount).toBe(7)
    })

    it('clears the length when the field is emptied', async () => {
      const wrapper = mountHost([{ seriesName: 'Dune', seriesIndex: '1', expectedBookCount: 6 }])

      await totalInput(wrapper).setValue('')

      expect(membershipsOf(wrapper)[0]?.expectedBookCount).toBeNull()
    })

    it('treats an unparseable length as cleared rather than NaN', async () => {
      const wrapper = mountHost([{ seriesName: 'Dune', seriesIndex: '1', expectedBookCount: 6 }])

      await totalInput(wrapper).setValue('abc')

      expect(membershipsOf(wrapper)[0]?.expectedBookCount).toBeNull()
    })

    it('labels the length field for assistive technology, since the row has no visible labels', () => {
      const wrapper = mountHost([{ seriesName: 'Dune', seriesIndex: '1', expectedBookCount: 6 }])

      expect(totalInput(wrapper).attributes('aria-label')).toBe('Books in series')
    })

    it('keeps each row length independent', async () => {
      const wrapper = mountHost([
        { seriesName: 'Dune', seriesIndex: '1', expectedBookCount: 6 },
        { seriesName: 'Legends', seriesIndex: '2', expectedBookCount: null },
      ])

      const totals = wrapper.findAll<HTMLInputElement>('input[type="number"][min="1"]')
      await totals[1]!.setValue('3')

      expect(membershipsOf(wrapper).map((m) => m.expectedBookCount)).toEqual([6, 3])
    })
  })

  describe('kind', () => {
    function membershipsOf(wrapper: ReturnType<typeof mountHost>): EditableSeriesMembership[] {
      return (wrapper.vm as { memberships: EditableSeriesMembership[] }).memberships
    }

    function menuItems(wrapper: ReturnType<typeof mountHost>, row = 0) {
      return wrapper.findAll('.radio-group')[row]!.findAll('.radio-item')
    }

    it('is left out where units are not edited', () => {
      const wrapper = mountHost([{ seriesName: 'Dune', seriesIndex: '1', expectedBookCount: null }])

      expect(wrapper.find('[data-testid="series-unit-menu"]').exists()).toBe(false)
    })

    it('sits before the position and names the current kind', () => {
      const wrapper = mountHost([{ seriesName: 'Harbor of Lanterns', seriesIndex: '87', expectedBookCount: null, unit: 'chapter' }], {
        unitEditable: true,
      })

      const trigger = wrapper.get('[data-testid="series-unit-menu"]')
      expect(trigger.text()).toBe('Chapter')
      expect(trigger.attributes('aria-label')).toBe('Kind: Chapter')
      const position = wrapper.get('input[aria-label="Position in series"]')
      expect(trigger.element.compareDocumentPosition(position.element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('reads None for an unclassified membership', () => {
      const wrapper = mountHost([{ seriesName: 'Dune', seriesIndex: '1', expectedBookCount: null, unit: null }], { unitEditable: true })

      expect(wrapper.get('[data-testid="series-unit-menu"]').text()).toBe('None')
      expect(wrapper.get('.radio-group').attributes('data-current')).toBe('none')
    })

    it('offers None, Volume, Chapter and Issue with the note on None', async () => {
      const wrapper = mountHost([{ seriesName: 'Harbor', seriesIndex: '87', expectedBookCount: null, unit: 'chapter' }], { unitEditable: true })

      const items = menuItems(wrapper)
      expect(items.map((item) => item.text())).toEqual(['None', 'Volume', 'Chapter', 'Issue'])
      expect(wrapper.get('.radio-group').attributes('data-current')).toBe('chapter')
      expect(items.map((item) => item.find('svg').exists())).toEqual([false, false, true, false])
      expect(wrapper.text()).toContain('None sorts with volumes.')
    })

    it('records the picked kind on its own row', async () => {
      const wrapper = mountHost(
        [
          { seriesName: 'Harbor', seriesIndex: '87', expectedBookCount: null, unit: 'chapter' },
          { seriesName: 'Tales', seriesIndex: '2', expectedBookCount: null, unit: null },
        ],
        { unitEditable: true },
      )

      await menuItems(wrapper, 1)[1]!.trigger('click')

      expect(membershipsOf(wrapper).map((membership) => membership.unit)).toEqual(['chapter', 'volume'])
    })

    it('clears the kind with None', async () => {
      const wrapper = mountHost([{ seriesName: 'Harbor', seriesIndex: '87', expectedBookCount: null, unit: 'chapter' }], { unitEditable: true })

      await menuItems(wrapper)[0]!.trigger('click')

      expect(membershipsOf(wrapper)[0]?.unit).toBeNull()
    })

    it('is locked with the series', () => {
      const wrapper = mountHost([{ seriesName: 'Harbor', seriesIndex: '87', expectedBookCount: null, unit: 'chapter' }], {
        unitEditable: true,
        disabled: true,
      })

      expect(wrapper.get('[data-testid="series-unit-menu"]').attributes('disabled')).toBeDefined()
    })

    it('starts an added series with no kind', async () => {
      const wrapper = mountHost([{ seriesName: 'Harbor', seriesIndex: '87', expectedBookCount: null, unit: 'chapter' }], { unitEditable: true })

      await wrapper.get('button[title="Add series"]').trigger('click')

      expect(membershipsOf(wrapper)[1]).toEqual({ seriesName: '', seriesIndex: null, expectedBookCount: null, unit: null })
    })
  })
})
