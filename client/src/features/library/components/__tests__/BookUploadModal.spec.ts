import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Library } from '@bookorbit/types'
import { i18n } from '@/i18n'
import BookUploadModal from '../BookUploadModal.vue'
import { makeLibrary } from '../../test/fixtures'
import type { FileUploadItem } from '../../composables/useBookUpload'

const libraries = ref<Library[]>([])
const loaded = ref(true)
const loading = ref(false)
const error = ref<string | null>(null)
const fetchLibraries = vi.fn<() => Promise<void>>()
const startUpload = vi.fn<(...args: unknown[]) => Promise<void>>()
const files = ref<FileUploadItem[]>([])
vi.mock('../../composables/useLibraries', () => ({
  useLibraries: () => ({ libraries, loaded, loading, error, fetchLibraries, refreshLibraries: vi.fn<() => Promise<void>>() }),
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn<(to: unknown) => void>() }) }))
vi.mock('@/features/settings/composables/useAppInfo', () => ({ useAppInfo: () => ({ maxUploadSizeMb: ref(500) }) }))
vi.mock('../../composables/useLibraryUploadEvents', () => ({ emitLibraryUploadCompleted: vi.fn<(event: unknown) => void>() }))
vi.mock('../../composables/useBookUpload', () => ({
  SUPPORTED_FORMATS: ['epub'],
  SUPPORTED_FORMATS_ACCEPT: '.epub',
  useBookUpload: () => ({
    files,
    pendingCount: computed(() => files.value.filter((file) => file.status === 'pending').length),
    isUploading: ref(false),
    doneCount: ref(0),
    errorCount: ref(0),
    uploadedBookIds: ref([]),
    addFiles: vi.fn<(files: File[]) => void>(),
    removeFile: vi.fn<(id: string) => void>(),
    retryFile: vi.fn<(id: string) => void>(),
    reset: vi.fn<() => void>(),
    startUpload,
  }),
}))
let wrapper: VueWrapper
function mountUpload(libraryId?: number) {
  wrapper = mount(BookUploadModal, { props: { libraryId }, global: { stubs: { Teleport: true } } })
  return wrapper
}
function uploadButton() {
  return wrapper.findAll('button').find((button) => button.text().startsWith('Upload ('))!
}

beforeEach(() => {
  i18n.global.locale.value = 'en'
  libraries.value = [makeLibrary()]
  loaded.value = true
  loading.value = false
  error.value = null
  fetchLibraries.mockReset().mockResolvedValue(undefined)
  startUpload.mockReset().mockResolvedValue(undefined)
  files.value = [{ id: 'book', file: new File(['book'], 'book.epub'), status: 'pending', progress: 0 }]
})
afterEach(() => wrapper?.unmount())

describe('BookUploadModal destination', () => {
  it('enables upload to the sole library without any selection and sends its folder', async () => {
    mountUpload()
    await flushPromises()
    expect(wrapper.find('select').exists()).toBe(false)
    expect(wrapper.text()).toContain('Upload to Main Library')
    expect(uploadButton().attributes('disabled')).toBeUndefined()
    expect(startUpload).not.toHaveBeenCalled()
    await uploadButton().trigger('click')
    expect(startUpload).toHaveBeenCalledExactlyOnceWith(3, 30)
  })

  it('waits for a delayed successful library load before enabling upload', async () => {
    libraries.value = []
    loaded.value = false
    loading.value = true
    let finish!: () => void
    fetchLibraries.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    mountUpload()
    expect(uploadButton().attributes('disabled')).toBeDefined()
    libraries.value = [makeLibrary()]
    loaded.value = true
    loading.value = false
    finish()
    await flushPromises()
    expect(uploadButton().attributes('disabled')).toBeUndefined()
    expect(wrapper.find('select').exists()).toBe(false)
  })

  it('requires a choice with multiple libraries and resets the folder when changing library', async () => {
    libraries.value.push(makeLibrary({ id: 4, name: 'Comics', folders: [{ id: 40, path: '/comics', role: 'downloads', createdAt: '2026-01-01' }] }))
    mountUpload()
    await flushPromises()
    expect(uploadButton().attributes('disabled')).toBeDefined()
    await wrapper.get('select').setValue('4')
    expect(wrapper.text()).toContain('Upload to Comics')
    await uploadButton().trigger('click')
    expect(startUpload).toHaveBeenLastCalledWith(4, 40)
    await wrapper.get('select').setValue('3')
    await uploadButton().trigger('click')
    expect(startUpload).toHaveBeenLastCalledWith(3, 30)
  })

  it('keeps multiple folders selectable in a sole library', async () => {
    libraries.value[0]!.folders.push({ ...libraries.value[0]!.folders[0]!, id: 31, path: '/books/second' })
    mountUpload()
    await flushPromises()
    expect(wrapper.findAll('select')).toHaveLength(1)
    await wrapper.get('select').setValue('31')
    await uploadButton().trigger('click')
    expect(startUpload).toHaveBeenCalledExactlyOnceWith(3, 31)
  })

  it('preserves a caller-scoped library even when it is not first', async () => {
    libraries.value.push(makeLibrary({ id: 4, name: 'Comics' }))
    mountUpload(4)
    await flushPromises()
    expect(wrapper.find('select').exists()).toBe(false)
    expect(wrapper.text()).toContain('Comics')
    await uploadButton().trigger('click')
    expect(startUpload).toHaveBeenCalledExactlyOnceWith(4, 30)
  })

  it('excludes podcast libraries from the sole-library calculation', async () => {
    libraries.value.unshift(makeLibrary({ id: 1, type: 'podcasts', name: 'Podcasts' }))
    mountUpload()
    await flushPromises()
    expect(wrapper.text()).not.toContain('Podcasts')
    await uploadButton().trigger('click')
    expect(startUpload).toHaveBeenCalledExactlyOnceWith(3, 30)
  })

  it.each(['empty', 'folderless', 'failed', 'unavailable'])('keeps upload disabled for a %s destination', async (scenario) => {
    if (scenario === 'empty') libraries.value = []
    if (scenario === 'folderless') libraries.value = [makeLibrary({ folders: [] })]
    if (scenario === 'failed') error.value = 'HTTP 503'
    mountUpload(scenario === 'unavailable' ? 99 : undefined)
    await flushPromises()
    expect(uploadButton().attributes('disabled')).toBeDefined()
    await uploadButton().trigger('click')
    expect(startUpload).not.toHaveBeenCalled()
    expect(wrapper.find('[role="status"], [role="alert"]').exists()).toBe(true)
  })

  it('disables upload if the selected folder is removed during a refresh', async () => {
    mountUpload()
    await flushPromises()
    libraries.value = [makeLibrary({ folders: [] })]
    await flushPromises()
    expect(uploadButton().attributes('disabled')).toBeDefined()
    expect(startUpload).not.toHaveBeenCalled()
  })
})
