import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookDetail } from '@bookorbit/types'
import { useCoverEditor } from '../../../composables/useCoverEditor'
import CoverEditorPanel from './CoverEditorPanel.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('../../../composables/useCoverEditor', () => ({
  useCoverEditor: vi.fn<() => unknown>(),
}))

vi.mock('../../../composables/useCoverVersions', () => ({
  useCoverVersions: () => ({
    coverUrl: vi.fn<() => string>().mockReturnValue('/cover.jpg'),
    bumpVersion: vi.fn<() => void>(),
  }),
}))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: vi.fn<() => boolean>().mockReturnValue(true) }),
}))

const book = {
  id: 1,
  title: 'Test Book',
  folderPath: '/books/Test Book',
  authors: [],
  files: [],
  coverSource: null,
  addedAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
} as unknown as BookDetail

function setupEditor() {
  const uploading = ref(false)
  const pendingFile = ref<File | null>(null)
  const pendingUrl = ref<string | null>(null)
  const setUrl = vi.fn<(url: string) => void>((url) => {
    pendingUrl.value = url || null
  })
  const confirm = vi.fn<() => Promise<boolean>>().mockResolvedValue(true)
  vi.mocked(useCoverEditor).mockReturnValue({
    uploading,
    error: ref<string | null>(null),
    previewSrc: ref<string | null>(null),
    pendingFile,
    pendingUrl,
    selectFile: vi.fn<(file: File) => void>(),
    setUrl,
    clearPending: vi.fn<() => void>(),
    confirm,
    revert: vi.fn<() => Promise<'extracted' | null | false>>(),
  })
  return { uploading, pendingUrl, setUrl, confirm }
}

function mountPanel(disabled = false) {
  return mount(CoverEditorPanel, {
    props: { book, disabled },
    global: {
      stubs: {
        BookCoverPlaceholder: true,
        CoverSearchDrawer: true,
        Teleport: true,
      },
    },
  })
}

describe('CoverEditorPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setupEditor()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('disables every visible cover mutation control when the parent is disabled', () => {
    const { pendingUrl } = setupEditor()
    pendingUrl.value = 'https://example.com/cover.jpg'
    const wrapper = mountPanel(true)

    const buttons = wrapper.findAll('button')
    expect(buttons.length).toBeGreaterThan(0)
    expect(buttons.every((button) => button.attributes('disabled') !== undefined)).toBe(true)
    expect(wrapper.get('input[type="file"]').attributes('disabled')).toBeDefined()
  })

  it('does not apply a debounced URL after saving disables the panel', async () => {
    const { setUrl } = setupEditor()
    const wrapper = mountPanel()
    const urlModeButton = wrapper.findAll('button').find((button) => button.text().includes('urlTab'))
    expect(urlModeButton).toBeDefined()
    await urlModeButton!.trigger('click')
    await wrapper.get('input').setValue('https://example.com/cover.jpg')

    await wrapper.setProps({ disabled: true })
    await vi.advanceTimersByTimeAsync(400)

    expect(setUrl).not.toHaveBeenCalled()
  })

  it('rejects overlapping exposed confirmations while an upload is active', async () => {
    const { uploading, confirm } = setupEditor()
    let resolveUpload!: (result: boolean) => void
    confirm.mockImplementation(() => {
      uploading.value = true
      return new Promise<boolean>((resolve) => {
        resolveUpload = (result) => {
          uploading.value = false
          resolve(result)
        }
      })
    })
    const wrapper = mountPanel()
    const exposed = wrapper.vm as unknown as { confirm: () => Promise<boolean> }

    const firstConfirmation = exposed.confirm()
    await expect(exposed.confirm()).resolves.toBe(false)
    resolveUpload(true)

    await expect(firstConfirmation).resolves.toBe(true)
    expect(confirm).toHaveBeenCalledTimes(1)
  })

  it('does not invoke an exposed confirmation while disabled', async () => {
    const { confirm } = setupEditor()
    const wrapper = mountPanel(true)
    const exposed = wrapper.vm as unknown as { confirm: () => Promise<boolean> }

    await expect(exposed.confirm()).resolves.toBe(false)
    expect(confirm).not.toHaveBeenCalled()
  })
})
