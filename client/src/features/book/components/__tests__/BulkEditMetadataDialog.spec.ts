import { mount, flushPromises } from '@vue/test-utils'
import { nextTick, defineComponent, h } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BulkEditMetadataDialog from '../BulkEditMetadataDialog.vue'

const searchMock = vi.fn<(q: string) => Promise<string[]>>().mockResolvedValue([])

vi.mock('@/features/book/composables/useAuthorSearch', () => ({
  useAuthorSearch: () => ({ search: searchMock }),
}))
vi.mock('@/features/book/composables/useTagSearch', () => ({
  useGenreSearch: () => ({ search: searchMock }),
  useTagSearch: () => ({ search: searchMock }),
}))
vi.mock('@/features/book/composables/useNarratorSearch', () => ({
  useNarratorSearch: () => ({ search: searchMock }),
}))
vi.mock('@/features/book/composables/useMetadataFieldSearch', () => ({
  usePublisherSearch: () => ({ search: searchMock }),
  useSeriesNameSearch: () => ({ search: searchMock }),
  useLanguageSearch: () => ({ search: searchMock }),
}))

const ChipInputStub = defineComponent({
  name: 'ChipInput',
  props: ['modelValue', 'searchFn', 'placeholder'],
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    return () =>
      h('div', { 'data-testid': 'chip-input' }, [
        h('input', {
          value: (props.modelValue as string[]).join(','),
          onInput: (e: Event) => {
            const val = (e.target as HTMLInputElement).value
            emit('update:modelValue', val ? val.split(',').map((s) => s.trim()) : [])
          },
        }),
      ])
  },
})

const InputWithSuggestionsStub = defineComponent({
  name: 'InputWithSuggestions',
  props: ['modelValue', 'searchFn', 'placeholder', 'disabled', 'class'],
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    return () =>
      h('input', {
        'data-testid': 'suggestions-input',
        value: props.modelValue ?? '',
        placeholder: props.placeholder,
        onInput: (e: Event) => emit('update:modelValue', (e.target as HTMLInputElement).value || null),
      })
  },
})

function mountDialog(props: { open?: boolean; bookCount?: number; submitting?: boolean } = {}) {
  return mount(BulkEditMetadataDialog, {
    props: {
      open: true,
      bookCount: 3,
      submitting: false,
      ...props,
    },
    global: {
      stubs: {
        Teleport: true,
        ChipInput: ChipInputStub,
        InputWithSuggestions: InputWithSuggestionsStub,
      },
    },
  })
}

describe('BulkEditMetadataDialog', () => {
  beforeEach(() => {
    searchMock.mockReset()
    searchMock.mockResolvedValue([])
  })

  describe('initial state', () => {
    it('renders the dialog when open', () => {
      const wrapper = mountDialog()
      expect(wrapper.find('h2').text()).toContain('Edit metadata - 3 books')
    })

    it('shows singular "book" for bookCount=1', () => {
      const wrapper = mountDialog({ bookCount: 1 })
      expect(wrapper.find('h2').text()).toContain('1 book')
      expect(wrapper.find('h2').text()).not.toContain('books')
    })

    it('renders all expected field labels', () => {
      const wrapper = mountDialog()
      const labels = ['Authors', 'Genres', 'Tags', 'Narrators', 'Series', 'Publisher', 'Language', 'Year']
      for (const label of labels) {
        expect(wrapper.text()).toContain(label)
      }
    })

    it('Apply button is disabled when no fields are enabled', () => {
      const wrapper = mountDialog()
      const applyBtn = wrapper.findAll('button').find((b) => b.text().includes('Apply'))
      expect(applyBtn?.attributes('disabled')).toBeDefined()
    })
  })

  describe('field toggling', () => {
    it('enables Publisher input when Publisher toggle is clicked', async () => {
      const wrapper = mountDialog()
      const publisherToggle = wrapper.findAll('button').find((b) => b.text() === 'Publisher')
      await publisherToggle!.trigger('click')
      await nextTick()
      expect(wrapper.findAll('[data-testid="suggestions-input"]').length).toBeGreaterThan(0)
    })

    it('enables Year input when Year toggle is clicked', async () => {
      const wrapper = mountDialog()
      const yearToggle = wrapper.findAll('button').find((b) => b.text() === 'Year')
      await yearToggle!.trigger('click')
      await nextTick()
      expect(wrapper.find('input[placeholder="e.g. 2024"]').exists()).toBe(true)
    })

    it('enables ChipInput when Authors toggle is clicked', async () => {
      const wrapper = mountDialog()
      const authorsToggle = wrapper.findAll('button').find((b) => b.text() === 'Authors')
      await authorsToggle!.trigger('click')
      await nextTick()
      expect(wrapper.find('[data-testid="chip-input"]').exists()).toBe(true)
    })

    it('shows mode buttons (Add/Remove/Replace/Clear) when array field is enabled', async () => {
      const wrapper = mountDialog()
      const authorsToggle = wrapper.findAll('button').find((b) => b.text() === 'Authors')
      await authorsToggle!.trigger('click')
      await nextTick()
      expect(wrapper.text()).toContain('Add')
      expect(wrapper.text()).toContain('Remove')
      expect(wrapper.text()).toContain('Replace')
      expect(wrapper.text()).toContain('Clear')
    })

    it('hides input when field is toggled off', async () => {
      const wrapper = mountDialog()
      const yearToggle = wrapper.findAll('button').find((b) => b.text() === 'Year')
      await yearToggle!.trigger('click')
      await nextTick()
      expect(wrapper.find('input[placeholder="e.g. 2024"]').exists()).toBe(true)
      await yearToggle!.trigger('click')
      await nextTick()
      expect(wrapper.find('input[placeholder="e.g. 2024"]').exists()).toBe(false)
    })
  })

  describe('canConfirm logic', () => {
    it('enables Apply when a scalar field is toggled on', async () => {
      const wrapper = mountDialog()
      const yearToggle = wrapper.findAll('button').find((b) => b.text() === 'Year')
      await yearToggle!.trigger('click')
      await nextTick()
      const applyBtn = wrapper.findAll('button').find((b) => b.text().includes('Apply'))
      expect(applyBtn?.attributes('disabled')).toBeUndefined()
    })

    it('disables Apply when array field is in Replace mode with no values', async () => {
      const wrapper = mountDialog()
      const genresToggle = wrapper.findAll('button').find((b) => b.text() === 'Genres')
      await genresToggle!.trigger('click')
      await nextTick()
      const replaceBtn = wrapper.findAll('button').find((b) => b.text() === 'Replace')
      await replaceBtn!.trigger('click')
      await nextTick()
      const applyBtn = wrapper.findAll('button').find((b) => b.text().includes('Apply'))
      expect(applyBtn?.attributes('disabled')).toBeDefined()
    })

    it('enables Apply when Clear mode is selected (no values needed)', async () => {
      const wrapper = mountDialog()
      const authorsToggle = wrapper.findAll('button').find((b) => b.text() === 'Authors')
      await authorsToggle!.trigger('click')
      await nextTick()
      const clearBtn = wrapper.findAll('button').find((b) => b.text() === 'Clear')
      await clearBtn!.trigger('click')
      await nextTick()
      const applyBtn = wrapper.findAll('button').find((b) => b.text().includes('Apply'))
      expect(applyBtn?.attributes('disabled')).toBeUndefined()
    })

    it('disables Apply when one field is Clear (valid) and another is Add with no values', async () => {
      const wrapper = mountDialog()
      const authorsToggle = wrapper.findAll('button').find((b) => b.text() === 'Authors')
      await authorsToggle!.trigger('click')
      await nextTick()
      const clearBtn = wrapper.findAll('button').find((b) => b.text() === 'Clear')
      await clearBtn!.trigger('click')
      await nextTick()
      const tagsToggle = wrapper.findAll('button').find((b) => b.text() === 'Tags')
      await tagsToggle!.trigger('click')
      await nextTick()
      const applyBtn = wrapper.findAll('button').find((b) => b.text().includes('Apply'))
      expect(applyBtn?.attributes('disabled')).toBeDefined()
    })

    it('disables Apply when array field is in Add mode with no values', async () => {
      const wrapper = mountDialog()
      const authorsToggle = wrapper.findAll('button').find((b) => b.text() === 'Authors')
      await authorsToggle!.trigger('click')
      await nextTick()
      const applyBtn = wrapper.findAll('button').find((b) => b.text().includes('Apply'))
      expect(applyBtn?.attributes('disabled')).toBeDefined()
    })

    it('disables Apply when array field is in Remove mode with no values', async () => {
      const wrapper = mountDialog()
      const tagsToggle = wrapper.findAll('button').find((b) => b.text() === 'Tags')
      await tagsToggle!.trigger('click')
      await nextTick()
      const removeBtn = wrapper.findAll('button').find((b) => b.text() === 'Remove')
      await removeBtn!.trigger('click')
      await nextTick()
      const applyBtn = wrapper.findAll('button').find((b) => b.text().includes('Apply'))
      expect(applyBtn?.attributes('disabled')).toBeDefined()
    })

    it('enables Apply when array field has values in Add mode', async () => {
      const wrapper = mountDialog()
      const tagsToggle = wrapper.findAll('button').find((b) => b.text() === 'Tags')
      await tagsToggle!.trigger('click')
      await nextTick()
      const chipInput = wrapper.find('[data-testid="chip-input"] input')
      await chipInput.setValue('fantasy')
      await chipInput.trigger('input')
      await nextTick()
      const applyBtn = wrapper.findAll('button').find((b) => b.text().includes('Apply'))
      expect(applyBtn?.attributes('disabled')).toBeUndefined()
    })

    it('disables Apply when year contains letters', async () => {
      const wrapper = mountDialog()
      const yearToggle = wrapper.findAll('button').find((b) => b.text() === 'Year')
      await yearToggle!.trigger('click')
      await nextTick()
      const yearInput = wrapper.find('input[placeholder="e.g. 2024"]')
      await yearInput.setValue('abc')
      await nextTick()
      const applyBtn = wrapper.findAll('button').find((b) => b.text().includes('Apply'))
      expect(applyBtn?.attributes('disabled')).toBeDefined()
    })

    it('disables Apply when year is partial numeric like "2024abc"', async () => {
      const wrapper = mountDialog()
      const yearToggle = wrapper.findAll('button').find((b) => b.text() === 'Year')
      await yearToggle!.trigger('click')
      await nextTick()
      const yearInput = wrapper.find('input[placeholder="e.g. 2024"]')
      await yearInput.setValue('2024abc')
      await nextTick()
      const applyBtn = wrapper.findAll('button').find((b) => b.text().includes('Apply'))
      expect(applyBtn?.attributes('disabled')).toBeDefined()
    })

    it('shows year validation error message for invalid input', async () => {
      const wrapper = mountDialog()
      const yearToggle = wrapper.findAll('button').find((b) => b.text() === 'Year')
      await yearToggle!.trigger('click')
      await nextTick()
      const yearInput = wrapper.find('input[placeholder="e.g. 2024"]')
      await yearInput.setValue('abc')
      await nextTick()
      expect(wrapper.text()).toContain('Enter a valid year (numbers only)')
    })

    it('hides year error message when year is valid', async () => {
      const wrapper = mountDialog()
      const yearToggle = wrapper.findAll('button').find((b) => b.text() === 'Year')
      await yearToggle!.trigger('click')
      await nextTick()
      const yearInput = wrapper.find('input[placeholder="e.g. 2024"]')
      await yearInput.setValue('2024')
      await nextTick()
      expect(wrapper.text()).not.toContain('Enter a valid year')
    })

    it('enables Apply and does not show error when year is empty (clear)', async () => {
      const wrapper = mountDialog()
      const yearToggle = wrapper.findAll('button').find((b) => b.text() === 'Year')
      await yearToggle!.trigger('click')
      await nextTick()
      const applyBtn = wrapper.findAll('button').find((b) => b.text().includes('Apply'))
      expect(applyBtn?.attributes('disabled')).toBeUndefined()
      expect(wrapper.text()).not.toContain('Enter a valid year')
    })
  })

  describe('emits', () => {
    it('emits confirm with correct scalar field when Apply is clicked', async () => {
      const wrapper = mountDialog()
      const yearToggle = wrapper.findAll('button').find((b) => b.text() === 'Year')
      await yearToggle!.trigger('click')
      await nextTick()
      const yearInput = wrapper.find('input[placeholder="e.g. 2024"]')
      await yearInput.setValue('2024')
      await nextTick()
      const applyBtn = wrapper.findAll('button').find((b) => b.text().includes('Apply'))
      await applyBtn!.trigger('click')
      await nextTick()
      const emitted = wrapper.emitted('confirm')
      expect(emitted).toHaveLength(1)
      const fields = (emitted![0] as [Record<string, unknown>])[0]
      expect(fields.publishedYear).toEqual({ value: 2024 })
    })

    it('emits confirm with null when scalar field is empty', async () => {
      const wrapper = mountDialog()
      const publisherToggle = wrapper.findAll('button').find((b) => b.text() === 'Publisher')
      await publisherToggle!.trigger('click')
      await nextTick()
      const applyBtn = wrapper.findAll('button').find((b) => b.text().includes('Apply'))
      await applyBtn!.trigger('click')
      await nextTick()
      const emitted = wrapper.emitted('confirm')
      const fields = (emitted![0] as [Record<string, unknown>])[0]
      expect(fields.publisher).toEqual({ value: null })
    })

    it('emits confirm with correct array field in replace mode', async () => {
      const wrapper = mountDialog()
      const genresToggle = wrapper.findAll('button').find((b) => b.text() === 'Genres')
      await genresToggle!.trigger('click')
      await nextTick()
      const replaceBtn = wrapper.findAll('button').find((b) => b.text() === 'Replace')
      await replaceBtn!.trigger('click')
      await nextTick()
      const chipInput = wrapper.find('[data-testid="chip-input"] input')
      await chipInput.setValue('Fantasy,Sci-Fi')
      await chipInput.trigger('input')
      await nextTick()
      const applyBtn = wrapper.findAll('button').find((b) => b.text().includes('Apply'))
      await applyBtn!.trigger('click')
      await nextTick()
      const emitted = wrapper.emitted('confirm')
      const fields = (emitted![0] as [Record<string, unknown>])[0]
      expect(fields.genres).toEqual({ mode: 'replace', values: ['Fantasy', 'Sci-Fi'] })
    })

    it('emits confirm with { mode: replace, values: [] } when Clear mode Apply is clicked', async () => {
      const wrapper = mountDialog()
      const tagsToggle = wrapper.findAll('button').find((b) => b.text() === 'Tags')
      await tagsToggle!.trigger('click')
      await nextTick()
      const clearBtn = wrapper.findAll('button').find((b) => b.text() === 'Clear')
      await clearBtn!.trigger('click')
      await nextTick()
      const applyBtn = wrapper.findAll('button').find((b) => b.text().includes('Apply'))
      await applyBtn!.trigger('click')
      await nextTick()
      const emitted = wrapper.emitted('confirm')
      expect(emitted).toHaveLength(1)
      const fields = (emitted![0] as [Record<string, unknown>])[0]
      expect(fields.tags).toEqual({ mode: 'replace', values: [] })
    })

    it('does not emit confirm when Apply is clicked while submitting', async () => {
      const wrapper = mountDialog({ submitting: true })
      const yearToggle = wrapper.findAll('button').find((b) => b.text() === 'Year')
      await yearToggle!.trigger('click')
      await nextTick()
      const applyBtn = wrapper.findAll('button').find((b) => b.text().includes('Applying'))
      await applyBtn?.trigger('click')
      await nextTick()
      expect(wrapper.emitted('confirm')).toBeUndefined()
    })

    it('emits update:open false when Cancel is clicked', async () => {
      const wrapper = mountDialog()
      const cancelBtn = wrapper.findAll('button').find((b) => b.text() === 'Cancel')
      await cancelBtn!.trigger('click')
      expect(wrapper.emitted('update:open')).toEqual([[false]])
    })

    it('emits update:open false when backdrop is clicked', async () => {
      const wrapper = mountDialog()
      const backdrop = wrapper.find('.absolute.inset-0')
      await backdrop.trigger('click')
      expect(wrapper.emitted('update:open')).toEqual([[false]])
    })

    it('does not emit update:open false when backdrop is clicked while submitting', async () => {
      const wrapper = mountDialog({ submitting: true })
      const backdrop = wrapper.find('.absolute.inset-0')
      await backdrop.trigger('click')
      expect(wrapper.emitted('update:open')).toBeUndefined()
    })
  })

  describe('submitting state', () => {
    it('shows Applying... text when submitting', () => {
      const wrapper = mountDialog({ submitting: true })
      const applyBtn = wrapper.findAll('button').find((b) => b.text().includes('Applying'))
      expect(applyBtn).toBeDefined()
    })

    it('disables Cancel button when submitting', () => {
      const wrapper = mountDialog({ submitting: true })
      const cancelBtn = wrapper.findAll('button').find((b) => b.text() === 'Cancel')
      expect(cancelBtn?.attributes('disabled')).toBeDefined()
    })
  })

  describe('form reset', () => {
    it('resets field state when dialog closes then reopens', async () => {
      const wrapper = mountDialog()
      const yearToggle = wrapper.findAll('button').find((b) => b.text() === 'Year')
      await yearToggle!.trigger('click')
      await nextTick()
      expect(wrapper.find('input[placeholder="e.g. 2024"]').exists()).toBe(true)
      await wrapper.setProps({ open: false })
      await nextTick()
      await wrapper.setProps({ open: true })
      await nextTick()
      expect(wrapper.find('input[placeholder="e.g. 2024"]').exists()).toBe(false)
    })

    it('resets array field values when dialog closes', async () => {
      const wrapper = mountDialog()
      const authorsToggle = wrapper.findAll('button').find((b) => b.text() === 'Authors')
      await authorsToggle!.trigger('click')
      await nextTick()
      const replaceBtn = wrapper.findAll('button').find((b) => b.text() === 'Replace')
      await replaceBtn!.trigger('click')
      await nextTick()
      const chipInput = wrapper.find('[data-testid="chip-input"] input')
      await chipInput.setValue('Author One')
      await chipInput.trigger('input')
      await nextTick()
      await wrapper.setProps({ open: false })
      await nextTick()
      await wrapper.setProps({ open: true })
      await nextTick()
      await flushPromises()
      expect(wrapper.find('[data-testid="chip-input"]').exists()).toBe(false)
    })
  })

  describe('array mode switching', () => {
    it('switches array field mode to Remove when Remove is clicked', async () => {
      const wrapper = mountDialog()
      const authorsToggle = wrapper.findAll('button').find((b) => b.text() === 'Authors')
      await authorsToggle!.trigger('click')
      await nextTick()
      const removeBtn = wrapper.findAll('button').find((b) => b.text() === 'Remove')
      await removeBtn!.trigger('click')
      await nextTick()
      const updatedRemoveBtn = wrapper.findAll('button').find((b) => b.text() === 'Remove')
      expect(updatedRemoveBtn?.classes()).toContain('bg-primary')
    })

    it('switches to Clear mode and highlights Clear pill with destructive style', async () => {
      const wrapper = mountDialog()
      const authorsToggle = wrapper.findAll('button').find((b) => b.text() === 'Authors')
      await authorsToggle!.trigger('click')
      await nextTick()
      const clearBtn = wrapper.findAll('button').find((b) => b.text() === 'Clear')
      await clearBtn!.trigger('click')
      await nextTick()
      const updatedClearBtn = wrapper.findAll('button').find((b) => b.text() === 'Clear')
      expect(updatedClearBtn?.classes()).toContain('bg-destructive')
    })

    it('hides ChipInput and shows warning when Clear mode is selected', async () => {
      const wrapper = mountDialog()
      const authorsToggle = wrapper.findAll('button').find((b) => b.text() === 'Authors')
      await authorsToggle!.trigger('click')
      await nextTick()
      const clearBtn = wrapper.findAll('button').find((b) => b.text() === 'Clear')
      await clearBtn!.trigger('click')
      await nextTick()
      expect(wrapper.find('[data-testid="chip-input"]').exists()).toBe(false)
      expect(wrapper.text()).toContain('This will remove all authors from the selected books.')
    })

    it('shows ChipInput again when switching from Clear back to Add', async () => {
      const wrapper = mountDialog()
      const tagsToggle = wrapper.findAll('button').find((b) => b.text() === 'Tags')
      await tagsToggle!.trigger('click')
      await nextTick()
      const clearBtn = wrapper.findAll('button').find((b) => b.text() === 'Clear')
      await clearBtn!.trigger('click')
      await nextTick()
      expect(wrapper.find('[data-testid="chip-input"]').exists()).toBe(false)
      const addBtn = wrapper.findAll('button').find((b) => b.text() === 'Add')
      await addBtn!.trigger('click')
      await nextTick()
      expect(wrapper.find('[data-testid="chip-input"]').exists()).toBe(true)
    })

    it('preserves chip values when switching to Clear and back to Replace', async () => {
      const wrapper = mountDialog()
      const genresToggle = wrapper.findAll('button').find((b) => b.text() === 'Genres')
      await genresToggle!.trigger('click')
      await nextTick()
      const replaceBtn = wrapper.findAll('button').find((b) => b.text() === 'Replace')
      await replaceBtn!.trigger('click')
      await nextTick()
      const chipInput = wrapper.find('[data-testid="chip-input"] input')
      await chipInput.setValue('Fantasy')
      await chipInput.trigger('input')
      await nextTick()
      const clearBtn = wrapper.findAll('button').find((b) => b.text() === 'Clear')
      await clearBtn!.trigger('click')
      await nextTick()
      const replaceBtn2 = wrapper.findAll('button').find((b) => b.text() === 'Replace')
      await replaceBtn2!.trigger('click')
      await nextTick()
      const chipInput2 = wrapper.find('[data-testid="chip-input"] input')
      expect((chipInput2.element as HTMLInputElement).value).toBe('Fantasy')
    })

    it('resets Clear mode to Add when dialog closes and reopens', async () => {
      const wrapper = mountDialog()
      const authorsToggle = wrapper.findAll('button').find((b) => b.text() === 'Authors')
      await authorsToggle!.trigger('click')
      await nextTick()
      const clearBtn = wrapper.findAll('button').find((b) => b.text() === 'Clear')
      await clearBtn!.trigger('click')
      await nextTick()
      await wrapper.setProps({ open: false })
      await nextTick()
      await wrapper.setProps({ open: true })
      await nextTick()
      await authorsToggle!.trigger('click')
      await nextTick()
      const updatedAddBtn = wrapper.findAll('button').find((b) => b.text() === 'Add')
      expect(updatedAddBtn?.classes()).toContain('bg-primary')
    })

    it('does not show the old empty-replace clear hint', async () => {
      const wrapper = mountDialog()
      const genresToggle = wrapper.findAll('button').find((b) => b.text() === 'Genres')
      await genresToggle!.trigger('click')
      await nextTick()
      const replaceBtn = wrapper.findAll('button').find((b) => b.text() === 'Replace')
      await replaceBtn!.trigger('click')
      await nextTick()
      expect(wrapper.text()).not.toContain('Apply with no values to clear all')
    })
  })
})
