import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookCoverSlot, BookDetail, BookMetadataLockField, CoverMedium } from '@bookorbit/types'
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
    coverUrl: (bookId: number, type: string, version?: string, medium?: string) =>
      `/api/v1/books/${bookId}/${type}?t=${version}&medium=${medium ?? ''}`,
    bumpVersion: vi.fn<() => void>(),
  }),
}))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: vi.fn<() => boolean>().mockReturnValue(true) }),
}))

function slot(source: BookCoverSlot['source'] = 'extracted', updatedAt = '2026-09-01T00:00:00.000Z'): BookCoverSlot {
  return { source, updatedAt, width: null, height: null }
}

function makeBook(overrides: Partial<BookDetail> = {}): BookDetail {
  return {
    id: 1,
    title: 'Test Book',
    folderPath: '/books/Test Book',
    authors: [],
    files: [],
    coverSource: null,
    coverMedia: ['ebook'],
    covers: { ebook: null, audio: null },
    coverVersion: 'ebook:-:-',
    lockedFields: [],
    addedAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
    ...overrides,
  } as unknown as BookDetail
}

const mixedBook = makeBook({
  coverSource: 'custom',
  coverMedia: ['ebook', 'audio'],
  covers: { ebook: slot('extracted', '2026-09-01T00:00:00.000Z'), audio: slot('custom', '2026-09-02T00:00:00.000Z') },
})

type FakeEditor = ReturnType<typeof fakeEditor>

function fakeEditor() {
  const uploading = ref(false)
  const regenerating = ref(false)
  const error = ref<string | null>(null)
  const previewSrc = ref<string | null>(null)
  const pendingFile = ref<File | null>(null)
  const pendingUrl = ref<string | null>(null)
  return {
    uploading,
    regenerating,
    error,
    previewSrc,
    pendingFile,
    pendingUrl,
    selectFile: vi.fn<(file: File) => void>(),
    setUrl: vi.fn<(url: string) => void>((url) => {
      pendingUrl.value = url || null
      previewSrc.value = url || null
    }),
    clearPending: vi.fn<() => void>(() => {
      pendingUrl.value = null
      pendingFile.value = null
      previewSrc.value = null
    }),
    confirm: vi.fn<() => Promise<boolean>>(async () => {
      pendingUrl.value = null
      previewSrc.value = null
      return true
    }),
    revert: vi.fn<() => Promise<'extracted' | null | false>>().mockResolvedValue('extracted'),
    regenerate: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
  }
}

let editors: Record<CoverMedium | 'none', FakeEditor>

function mountPanel(options: { book?: BookDetail; disabled?: boolean; lockedFields?: BookMetadataLockField[] } = {}) {
  return mount(CoverEditorPanel, {
    props: { book: options.book ?? makeBook(), disabled: options.disabled ?? false, lockedFields: options.lockedFields ?? [] },
    attachTo: document.body,
    global: {
      stubs: {
        BookCoverPlaceholder: { template: '<div data-test="placeholder" />' },
        BookCoverLightbox: true,
        CoverSearchDrawer: { props: ['open', 'isAudiobook'], template: '<div data-test="search" :data-audiobook="String(isAudiobook)" />' },
      },
    },
  })
}

type ExposedPanel = {
  confirm: (media?: (CoverMedium | null)[]) => Promise<boolean>
  setUrl: (url: string) => void
  hasPending: boolean
  pendingMedia: (CoverMedium | null)[]
  reset: () => void
}

function radios(wrapper: ReturnType<typeof mountPanel>) {
  return wrapper.findAll('[role="radio"]')
}

describe('CoverEditorPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    editors = { ebook: fakeEditor(), audio: fakeEditor(), none: fakeEditor() }
    vi.mocked(useCoverEditor).mockImplementation((_bookId, medium) => editors[medium ?? 'none'] as never)
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  describe('one medium', () => {
    it('sizes its layout from its own column instead of the viewport', () => {
      const wrapper = mountPanel()
      const container = wrapper.get('.\\@container\\/cover-editor')
      const layout = container.get(':scope > div')

      expect(layout.classes()).toContain('@min-[21rem]/cover-editor:flex-row')
      expect(layout.classes()).not.toContain('lg:flex-col')
      expect(layout.get(':scope > div').classes()).toContain('@min-[21rem]/cover-editor:w-36')
    })

    it('shows a single cover with no tile choice', () => {
      const wrapper = mountPanel({ book: makeBook({ coverSource: 'extracted', covers: { ebook: slot(), audio: null } }) })

      expect(wrapper.find('[role="radiogroup"]').exists()).toBe(false)
      expect(wrapper.get('img').attributes('src')).toContain('medium=ebook')
    })

    it('uses the audio lock key for a book that only has an audiobook', async () => {
      const wrapper = mountPanel({ book: makeBook({ coverMedia: ['audio'] }), lockedFields: ['audioCover'] })

      const lock = wrapper.get('[aria-label="book.detail.coverEditor.unlockCover"]')
      await lock.trigger('click')

      expect(wrapper.emitted('toggleLock')).toEqual([['audioCover']])
      expect(wrapper.get('input[type="file"]').attributes('disabled')).toBeDefined()
    })

    it('shows a legacy cover that no slot holds yet', () => {
      const wrapper = mountPanel({ book: makeBook({ coverSource: 'custom', coverVersion: 'legacy:1' }) })

      expect(wrapper.find('[data-test="placeholder"]').exists()).toBe(false)
      expect(wrapper.get('img').attributes('src')).toContain('t=legacy:1')
      expect(wrapper.text()).toContain('book.detail.coverEditor.revertToOriginal')
    })

    it('disables every visible cover control when the parent is disabled', () => {
      editors.ebook.pendingUrl.value = 'https://example.com/cover.jpg'
      const wrapper = mountPanel({ disabled: true })

      const buttons = wrapper.findAll('button')
      expect(buttons.length).toBeGreaterThan(0)
      expect(buttons.every((button) => button.attributes('disabled') !== undefined)).toBe(true)
      expect(wrapper.get('input[type="file"]').attributes('disabled')).toBeDefined()
    })

    it('does not apply a debounced URL after saving disables the panel', async () => {
      const wrapper = mountPanel()
      await wrapper.get('[aria-pressed="false"]').trigger('click')
      await wrapper.get('input[aria-label="book.detail.coverEditor.urlLabel"]').setValue('https://example.com/cover.jpg')

      await wrapper.setProps({ disabled: true })
      await vi.advanceTimersByTimeAsync(400)

      expect(editors.ebook.setUrl).not.toHaveBeenCalled()
    })

    it('rejects overlapping exposed confirmations while an upload is active', async () => {
      editors.ebook.pendingUrl.value = 'https://example.com/cover.jpg'
      let resolveUpload!: (result: boolean) => void
      editors.ebook.confirm.mockImplementation(() => {
        editors.ebook.uploading.value = true
        return new Promise<boolean>((resolve) => {
          resolveUpload = (result) => {
            editors.ebook.uploading.value = false
            resolve(result)
          }
        })
      })
      const wrapper = mountPanel()
      const exposed = wrapper.vm as unknown as ExposedPanel

      const firstConfirmation = exposed.confirm()
      await expect(exposed.confirm()).resolves.toBe(false)
      resolveUpload(true)

      await expect(firstConfirmation).resolves.toBe(true)
      expect(editors.ebook.confirm).toHaveBeenCalledTimes(1)
    })

    it('does not invoke an exposed confirmation while disabled', async () => {
      editors.ebook.pendingUrl.value = 'https://example.com/cover.jpg'
      const wrapper = mountPanel({ disabled: true })
      const exposed = wrapper.vm as unknown as ExposedPanel

      await expect(exposed.confirm()).resolves.toBe(false)
      expect(editors.ebook.confirm).not.toHaveBeenCalled()
    })
  })

  describe('two media', () => {
    it('offers a Book and an Audiobook tile as a radio group, with the book selected first', () => {
      const wrapper = mountPanel({ book: mixedBook })

      const group = wrapper.get('[role="radiogroup"]')
      expect(group.attributes('aria-label')).toBe('book.detail.coverEditor.slotsLabel')
      expect(radios(wrapper).map((radio) => radio.attributes('aria-label'))).toEqual([
        'book.detail.coverEditor.slotEbookName',
        'book.detail.coverEditor.slotAudioName',
      ])
      expect(radios(wrapper).map((radio) => radio.attributes('aria-checked'))).toEqual(['true', 'false'])
      expect(radios(wrapper).map((radio) => radio.attributes('tabindex'))).toEqual(['0', '-1'])
      expect(wrapper.text()).toContain('book.detail.coverEditor.editingEbook')
    })

    it('loads each tile from its own slot', () => {
      const wrapper = mountPanel({ book: mixedBook })

      const sources = wrapper.findAll('[role="radio"] img').map((img) => img.attributes('src'))
      expect(sources).toEqual([
        '/api/v1/books/1/cover?t=2026-09-01T00:00:00.000Z&medium=ebook',
        '/api/v1/books/1/cover?t=2026-09-02T00:00:00.000Z&medium=audio',
      ])
    })

    it('shows the placeholder for an empty slot instead of requesting it', () => {
      const wrapper = mountPanel({
        book: makeBook({ coverSource: 'extracted', coverMedia: ['ebook', 'audio'], covers: { ebook: slot(), audio: null } }),
      })

      expect(wrapper.findAll('[role="radio"] img')).toHaveLength(1)
      expect(wrapper.findAll('[role="radio"] [data-test="placeholder"]')).toHaveLength(1)
    })

    it('selects a tile on click and points the shared controls at it', async () => {
      const wrapper = mountPanel({ book: mixedBook })

      await radios(wrapper)[1]!.trigger('click')

      expect(radios(wrapper).map((radio) => radio.attributes('aria-checked'))).toEqual(['false', 'true'])
      expect(wrapper.text()).toContain('book.detail.coverEditor.editingAudio')
      expect(wrapper.get('[data-test="search"]').attributes('data-audiobook')).toBe('true')
      const controls = wrapper.get('[role="group"][aria-labelledby]')
      expect(wrapper.get(`#${controls.attributes('aria-labelledby')}`).text()).toBe('book.detail.coverEditor.editingAudio')
    })

    it('moves the selection and focus with the arrow keys', async () => {
      const wrapper = mountPanel({ book: mixedBook })

      await radios(wrapper)[0]!.trigger('keydown', { key: 'ArrowRight' })
      await wrapper.vm.$nextTick()

      expect(radios(wrapper)[1]!.attributes('aria-checked')).toBe('true')
      expect(document.activeElement).toBe(radios(wrapper)[1]!.element)
    })

    it('keeps each lock outside its radio and toggles that slot', async () => {
      const wrapper = mountPanel({ book: mixedBook, lockedFields: ['audioCover'] })

      expect(wrapper.find('[role="radio"] button').exists()).toBe(false)
      await wrapper.get('[aria-label="book.detail.coverEditor.lockEbookCover"]').trigger('click')
      await wrapper.get('[aria-label="book.detail.coverEditor.unlockAudioCover"]').trigger('click')

      expect(wrapper.emitted('toggleLock')).toEqual([['cover'], ['audioCover']])
    })

    it('disables the controls only while the selected tile is locked', async () => {
      const wrapper = mountPanel({ book: mixedBook, lockedFields: ['audioCover'] })
      expect(wrapper.get('input[type="file"]').attributes('disabled')).toBeUndefined()

      await radios(wrapper)[1]!.trigger('click')

      expect(wrapper.get('input[type="file"]').attributes('disabled')).toBeDefined()
    })

    it('opens the lightbox on the tile whose View larger was pressed', async () => {
      const wrapper = mountPanel({ book: mixedBook })

      await wrapper.get('[aria-label="book.detail.coverEditor.viewLargerAudio"]').trigger('click')

      const lightbox = wrapper.getComponent({ name: 'BookCoverLightbox' })
      expect(lightbox.props('open')).toBe(true)
      expect(lightbox.props('medium')).toBe('audio')
      expect(radios(wrapper)[0]!.attributes('aria-checked')).toBe('true')
    })

    it('keeps a pending image per tile and applies URL input to the selected one', async () => {
      const wrapper = mountPanel({ book: mixedBook })
      await radios(wrapper)[1]!.trigger('click')
      await wrapper.get('[aria-pressed="false"]').trigger('click')
      await wrapper.get('input[aria-label="book.detail.coverEditor.urlLabel"]').setValue('https://example.com/square.jpg')
      await vi.advanceTimersByTimeAsync(400)

      expect(editors.audio.setUrl).toHaveBeenCalledWith('https://example.com/square.jpg')
      expect(editors.ebook.setUrl).not.toHaveBeenCalled()

      await radios(wrapper)[0]!.trigger('click')
      expect(wrapper.find('input[aria-label="book.detail.coverEditor.urlLabel"]').exists()).toBe(false)
      expect((wrapper.vm as unknown as ExposedPanel).pendingMedia).toEqual(['audio'])
    })

    it('shows Revert only for the selected tile when its slot is custom', async () => {
      const wrapper = mountPanel({ book: mixedBook })
      expect(wrapper.text()).not.toContain('book.detail.coverEditor.revertToOriginal')

      await radios(wrapper)[1]!.trigger('click')
      const revert = wrapper.findAll('button').find((button) => button.text().includes('book.detail.coverEditor.revertToOriginal'))
      await revert!.trigger('click')
      await vi.runAllTimersAsync()

      expect(editors.audio.revert).toHaveBeenCalledTimes(1)
      expect(wrapper.emitted('coverChanged')).toEqual([['audio']])
    })

    it('regenerates the selected slot and reports its medium', async () => {
      const wrapper = mountPanel({ book: mixedBook })
      await radios(wrapper)[1]!.trigger('click')

      const regenerate = wrapper.findAll('button').find((button) => button.text().includes('book.detail.coverEditor.regenerateCover'))
      await regenerate!.trigger('click')
      await vi.runAllTimersAsync()

      expect(editors.audio.regenerate).toHaveBeenCalledTimes(1)
      expect(editors.ebook.regenerate).not.toHaveBeenCalled()
      expect(wrapper.emitted('coverChanged')).toEqual([['audio']])
    })

    it('saves every pending tile and reports each medium', async () => {
      editors.ebook.pendingUrl.value = 'https://example.com/portrait.jpg'
      editors.audio.pendingUrl.value = 'https://example.com/square.jpg'
      const wrapper = mountPanel({ book: mixedBook })
      const exposed = wrapper.vm as unknown as ExposedPanel

      expect(exposed.hasPending).toBe(true)
      await expect(exposed.confirm()).resolves.toBe(true)

      expect(editors.ebook.confirm).toHaveBeenCalledTimes(1)
      expect(editors.audio.confirm).toHaveBeenCalledTimes(1)
      expect(wrapper.emitted('coverChanged')).toEqual([['ebook'], ['audio']])
    })

    it('saves only the tiles it is asked for', async () => {
      editors.ebook.pendingUrl.value = 'https://example.com/portrait.jpg'
      editors.audio.pendingUrl.value = 'https://example.com/square.jpg'
      const wrapper = mountPanel({ book: mixedBook })

      await expect((wrapper.vm as unknown as ExposedPanel).confirm(['audio'])).resolves.toBe(true)

      expect(editors.ebook.confirm).not.toHaveBeenCalled()
      expect(editors.audio.confirm).toHaveBeenCalledTimes(1)
    })

    it('stops at the first failed tile and selects it', async () => {
      editors.ebook.pendingUrl.value = 'https://example.com/portrait.jpg'
      editors.audio.pendingUrl.value = 'https://example.com/square.jpg'
      editors.ebook.confirm.mockResolvedValue(false)
      const wrapper = mountPanel({ book: mixedBook })
      await radios(wrapper)[1]!.trigger('click')

      await expect((wrapper.vm as unknown as ExposedPanel).confirm()).resolves.toBe(false)
      await wrapper.vm.$nextTick()

      expect(editors.audio.confirm).not.toHaveBeenCalled()
      expect(radios(wrapper)[0]!.attributes('aria-checked')).toBe('true')
      expect(wrapper.emitted('coverChanged')).toBeUndefined()
    })

    it('routes a metadata result cover to the book tile and selects it', async () => {
      const wrapper = mountPanel({ book: mixedBook })
      await radios(wrapper)[1]!.trigger('click')

      ;(wrapper.vm as unknown as ExposedPanel).setUrl('https://example.com/result.jpg')
      await wrapper.vm.$nextTick()

      expect(editors.ebook.setUrl).toHaveBeenCalledWith('https://example.com/result.jpg')
      expect(radios(wrapper)[0]!.attributes('aria-checked')).toBe('true')
    })

    it('clears every tile on reset', async () => {
      editors.ebook.pendingUrl.value = 'https://example.com/portrait.jpg'
      editors.audio.pendingUrl.value = 'https://example.com/square.jpg'
      const wrapper = mountPanel({ book: mixedBook })

      ;(wrapper.vm as unknown as ExposedPanel).reset()

      expect(editors.ebook.clearPending).toHaveBeenCalled()
      expect(editors.audio.clearPending).toHaveBeenCalled()
      expect((wrapper.vm as unknown as ExposedPanel).hasPending).toBe(false)
    })
  })

  describe('accessibility of the shared controls', () => {
    it('keeps the file input reachable by keyboard and labels the URL input', async () => {
      const wrapper = mountPanel()

      const fileInput = wrapper.get('input[type="file"]')
      expect(fileInput.classes()).toContain('sr-only')
      expect(fileInput.classes()).not.toContain('hidden')

      const modes = wrapper.findAll('[aria-pressed]')
      expect(modes.map((mode) => mode.attributes('aria-pressed'))).toEqual(['true', 'false'])
      await modes[1]!.trigger('click')
      expect(wrapper.find('input[aria-label="book.detail.coverEditor.urlLabel"]').exists()).toBe(true)
    })
  })
})
