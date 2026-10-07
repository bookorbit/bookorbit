import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Library } from '@bookorbit/types'
import { i18n } from '@/i18n'
import BookDestinationFields from '../BookDestinationFields.vue'
import { useBookDestination } from '../../composables/useBookDestination'
import { makeLibrary } from '../../test/fixtures'

const libraries = ref<Library[]>([])
const loaded = ref(true)
const loading = ref(false)
const error = ref<string | null>(null)
vi.mock('../../composables/useLibraries', () => ({
  useLibraries: () => ({
    libraries,
    loaded,
    loading,
    error,
    fetchLibraries: vi.fn<() => Promise<void>>(),
    refreshLibraries: vi.fn<() => Promise<void>>(),
  }),
}))
let wrapper: VueWrapper
function mountFields(options: Parameters<typeof useBookDestination>[0] = {}, scoped = false) {
  wrapper = mount(
    defineComponent({
      setup() {
        const destination = useBookDestination(options)
        return () => h(BookDestinationFields, { destination, libraryLabel: 'Library', folderLabel: 'Folder', scoped })
      },
    }),
  )
  return wrapper.getComponent(BookDestinationFields)
}

beforeEach(() => {
  i18n.global.locale.value = 'en'
  libraries.value = [makeLibrary()]
  loaded.value = true
  loading.value = false
  error.value = null
})
afterEach(() => wrapper?.unmount())

describe('BookDestinationFields', () => {
  it('renders the sole library and folder as readable text without selects', () => {
    mountFields()
    expect(wrapper.findAll('select')).toHaveLength(0)
    expect(wrapper.findAll('dt').map((term) => term.text())).toEqual(['Library', 'Folder'])
    expect(wrapper.findAll('dd').map((value) => value.text())).toEqual(['Main Library', '/books'])
  })

  it('offers a programmatically labelled folder selector when only folders require a choice', async () => {
    libraries.value[0]!.folders.push({ ...libraries.value[0]!.folders[0]!, id: 31, path: '/books/second' })
    const fields = mountFields()
    const label = wrapper.get('label')
    expect(label.text()).toContain('Folder')
    expect(wrapper.findAll('select')).toHaveLength(1)
    await label.get('select').setValue('31')
    expect(fields.props('destination').folderId.value).toBe(31)
    expect(fields.emitted('change')).toEqual([[]])
  })

  it('offers a library selector and keeps a scoped library read-only', async () => {
    libraries.value.push(makeLibrary({ id: 4, name: 'Comics' }))
    const fields = mountFields()
    expect(wrapper.get('label').text()).toContain('Library')
    await wrapper.get('select').setValue('4')
    expect(fields.props('destination').libraryId.value).toBe(4)
    expect(wrapper.get('dd').text()).toBe('/books')
    wrapper.unmount()
    mountFields({ libraryId: 4 }, true)
    expect(wrapper.find('select').exists()).toBe(false)
    expect(wrapper.text()).toContain('Comics')
  })

  it('exposes loading, failure, and empty states accessibly', async () => {
    loaded.value = false
    mountFields()
    expect(wrapper.get('[role="status"]').text()).toBe('Loading...')
    error.value = 'HTTP 503'
    await nextTick()
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not load')
    expect(wrapper.text()).not.toContain('HTTP 503')
    error.value = null
    loaded.value = true
    libraries.value = []
    await nextTick()
    expect(wrapper.get('[role="status"]').text()).toContain('No book libraries')
  })

  it('explains a missing folder without showing an empty dropdown', () => {
    libraries.value = [makeLibrary({ folders: [] })]
    mountFields()
    expect(wrapper.get('[role="status"]').text()).toContain('no destination folders')
    expect(wrapper.find('select').exists()).toBe(false)
  })

  it('allows an unavailable carried destination to be corrected even with one choice', async () => {
    const fields = mountFields({ libraryId: 99, folderId: 99 })
    expect(wrapper.get<HTMLSelectElement>('select').element.value).toBe('')
    await wrapper.get('select').setValue('3')
    expect(fields.props('destination').hasDestination.value).toBe(true)
    expect(wrapper.find('select').exists()).toBe(false)
  })

  it('shows an unavailable scoped library without silently replacing it', () => {
    mountFields({ libraryId: 99 }, true)
    expect(wrapper.get('[role="alert"]').text()).toContain('no longer available')
    expect(wrapper.find('select').exists()).toBe(false)
  })
})
