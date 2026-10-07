import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthUser, BookDetail, CoverMedium } from '@bookorbit/types'
import { api } from '@/lib/api'
import EditMetadataTab from '../EditMetadataTab.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: ref('en') }),
}))

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn<() => void>(), info: vi.fn<() => void>(), warning: vi.fn<() => void>(), error: vi.fn<() => void>() },
}))

vi.mock('@/lib/api', () => ({
  api: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(),
  setOnAuthFailure: vi.fn<(callback: () => void) => void>(),
}))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: () => true }),
}))

const reminderUser = ref<AuthUser>({ id: 7, settings: {} } as AuthUser)
vi.mock('@/features/auth/composables/useAuth', () => ({ useAuth: () => ({ user: reminderUser }) }))

const panel = {
  hasPending: ref(false),
  pendingMedia: ref<(CoverMedium | null)[]>([]),
  busy: ref(false),
  confirm: vi.fn<(media?: (CoverMedium | null)[]) => Promise<boolean>>(),
  setUrl: vi.fn<(url: string) => void>(),
  reset: vi.fn<() => void>(),
}

const CoverEditorPanelStub = defineComponent({
  name: 'CoverEditorPanel',
  props: ['book', 'lockedFields', 'disabled'],
  emits: ['coverChanged', 'toggleLock'],
  setup(_props, { expose }) {
    expose(panel)
    return {}
  },
  template: '<div data-test="cover-panel" />',
})

const MetadataSearchDrawerStub = defineComponent({
  name: 'MetadataSearchDrawer',
  props: ['book', 'lockedFields'],
  emits: ['close', 'apply'],
  template: '<div data-test="search-drawer" />',
})

function makeBook(overrides: Partial<BookDetail> = {}): BookDetail {
  return {
    id: 7,
    libraryId: 1,
    libraryName: 'Library',
    addedAt: '2024-01-01T00:00:00.000Z',
    updatedAt: null,
    status: 'present',
    title: 'Dune',
    subtitle: null,
    description: null,
    isbn10: null,
    isbn13: null,
    publisher: null,
    publishedDate: null,
    publishedYear: null,
    language: null,
    pageCount: null,
    seriesName: null,
    seriesIndex: null,
    seriesMemberships: [],
    rating: null,
    personalNote: null,
    personalNoteUpdatedAt: null,
    communityRatings: [],
    coverSource: 'extracted',
    coverMedia: ['ebook', 'audio'],
    covers: { ebook: null, audio: null },
    coverVersion: 'v',
    hardcoverEditionId: null,
    providerIds: {},
    authors: [],
    narrators: [],
    genres: [],
    tags: [],
    files: [],
    folderPath: '/books/Dune',
    lastWrittenAt: null,
    metadataScore: null,
    readStatus: null,
    audioMetadata: null,
    formatPriority: [],
    comicMetadata: null,
    customMetadata: [],
    lockedFields: [],
    collections: [],
    ...overrides,
  } as unknown as BookDetail
}

function json(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as Response
}

function patchCalls() {
  return vi.mocked(api).mock.calls.filter(([, init]) => init?.method === 'PATCH')
}

function mountTab(book: BookDetail) {
  return mount(EditMetadataTab, {
    props: { book },
    global: {
      stubs: {
        CoverEditorPanel: CoverEditorPanelStub,
        MetadataSearchDrawer: MetadataSearchDrawerStub,
        MetadataSourceCard: true,
        MetadataFieldLabel: { props: ['field'], template: '<div :data-field="field"><slot /></div>' },
        RichDescriptionEditor: true,
        SeriesMembershipEditor: true,
        ChipInput: true,
        InputWithSuggestions: true,
        WriteAndRenameResultPanel: true,
        Tooltip: { template: '<div><slot /></div>' },
        TooltipTrigger: { template: '<div><slot /></div>' },
        TooltipContent: { template: '<div><slot /></div>' },
      },
    },
  })
}

function saveButton(wrapper: ReturnType<typeof mountTab>) {
  return wrapper.findAll('button').find((button) => button.text().includes('common.save'))!
}

describe('EditMetadataTab cover tiles', () => {
  let savedBook: BookDetail

  beforeEach(() => {
    reminderUser.value = { id: 7, settings: {} } as AuthUser
    panel.hasPending.value = false
    panel.pendingMedia.value = []
    panel.busy.value = false
    panel.confirm.mockReset()
    panel.confirm.mockResolvedValue(true)
    panel.setUrl.mockReset()
    panel.reset.mockReset()
    savedBook = makeBook()
    vi.mocked(api).mockReset()
    vi.mocked(api).mockImplementation(async (url, init) => {
      if (init?.method === 'PATCH') return json({ book: savedBook, write: null, libraryAutoWriteEnabled: false })
      if (String(url).includes('/metadata-fetch/providers')) return json([])
      return json({})
    })
  })

  it('opens a popover listing only empty fields without opening metadata search', async () => {
    const wrapper = mountTab(makeBook({ publisher: 'Ace', publishedYear: 1965 }))
    document.body.append(wrapper.element)
    await flushPromises()

    const badge = wrapper.get('[aria-label="metadataReminders.missingCount"]')
    await badge.trigger('click')
    await flushPromises()

    const popover = document.querySelector('[data-slot="popover-content"]')!
    expect(popover).not.toBeNull()
    expect(Array.from(popover.querySelectorAll('li'), (item) => item.textContent)).toEqual([
      'metadataReminders.fields.language.label',
      'metadataReminders.fields.pageCount.label',
      'metadataReminders.fields.isbn.label',
      'metadataReminders.fields.genres.label',
      'metadataReminders.fields.tags.label',
      'metadataReminders.fields.description.label',
    ])
    expect(badge.attributes('aria-expanded')).toBe('true')
    expect(wrapper.findComponent(MetadataSearchDrawerStub).exists()).toBe(false)
    expect(vi.mocked(api).mock.calls.some(([url]) => String(url).includes('/metadata-fetch/stream'))).toBe(false)

    await wrapper.setProps({ book: makeBook({ publisher: 'Ace', publishedYear: 1965, language: 'en' }) })
    await flushPromises()
    expect(popover.textContent).not.toContain('metadataReminders.fields.language.label')
    wrapper.unmount()
  })

  it('enables Save when the only change is an unsaved cover', async () => {
    const wrapper = mountTab(makeBook())
    await flushPromises()
    expect(saveButton(wrapper).attributes('disabled')).toBeDefined()

    panel.hasPending.value = true
    panel.pendingMedia.value = ['audio']
    await flushPromises()

    expect(saveButton(wrapper).attributes('disabled')).toBeUndefined()
  })

  it('applies preview ISBNs to the editor and saves them only after Save', async () => {
    vi.mocked(api).mockImplementation(async (url, init) => {
      if (String(url).includes('/refresh-metadata?preview=true')) {
        return json({
          metadata: { isbn10: '0306406152', isbn13: '9780306406157' },
          diagnostics: { candidateProviders: ['google'], enabledUnreferencedProviders: [] },
        })
      }
      if (init?.method === 'PATCH') return json({ book: savedBook, write: null, libraryAutoWriteEnabled: false })
      if (String(url).includes('/metadata-fetch/providers')) return json([])
      return json({})
    })
    const wrapper = mountTab(makeBook())
    await flushPromises()
    const autoFillButton = wrapper.findAll('button').find((button) => button.text().includes('book.detail.editMetadata.autoFill'))!
    await autoFillButton.trigger('click')
    await flushPromises()
    expect(patchCalls()).toHaveLength(0)
    expect((wrapper.get('[data-field="isbn10"] input').element as HTMLInputElement).value).toBe('0306406152')
    expect((wrapper.get('[data-field="isbn13"] input').element as HTMLInputElement).value).toBe('9780306406157')
    await saveButton(wrapper).trigger('click')
    await flushPromises()
    const body = JSON.parse(patchCalls()[0]![1]!.body as string)
    expect(body.metadata).toMatchObject({ isbn10: '0306406152', isbn13: '9780306406157' })
  })

  it.each(['isbn10', 'isbn13'] as const)('preserves the %s lock when applying preview ISBNs', async (lockedField) => {
    vi.mocked(api).mockImplementation(async (url) => {
      if (String(url).includes('/refresh-metadata?preview=true')) {
        return json({
          metadata: { isbn10: '0306406152', isbn13: '9780306406157' },
          diagnostics: { candidateProviders: ['google'], enabledUnreferencedProviders: [] },
        })
      }
      if (String(url).includes('/metadata-fetch/providers')) return json([])
      return json({})
    })
    const wrapper = mountTab(makeBook({ lockedFields: [lockedField] }))
    await flushPromises()
    await wrapper.get('[aria-label="book.detail.editMetadata.autoFill"]').trigger('click')
    await flushPromises()
    expect((wrapper.get(`[data-field="${lockedField}"] input`).element as HTMLInputElement).value).toBe('')
    const unlockedField = lockedField === 'isbn10' ? 'isbn13' : 'isbn10'
    expect((wrapper.get(`[data-field="${unlockedField}"] input`).element as HTMLInputElement).value).toBe(
      unlockedField === 'isbn10' ? '0306406152' : '9780306406157',
    )
  })

  it('opens reminder preferences from the popover without leaving the unsaved book form', async () => {
    const wrapper = mountTab(makeBook())
    document.body.append(wrapper.element)
    await flushPromises()
    await wrapper.get('[data-field="title"] input').setValue('Unsaved title')
    await wrapper.get('[aria-label="metadataReminders.missingCount"]').trigger('click')
    await flushPromises()
    const customize = document.querySelector<HTMLButtonElement>('[data-slot="popover-content"] button')!
    customize.click()
    await flushPromises()
    const sheet = document.querySelector('[data-slot="sheet-content"]')!
    expect(sheet).not.toBeNull()
    expect(sheet.textContent).toContain('metadataReminders.title')
    expect(patchCalls()).toHaveLength(0)
    expect((wrapper.get('[data-field="title"] input').element as HTMLInputElement).value).toBe('Unsaved title')
    wrapper.unmount()
  })

  it('hides reminders when the only absent identifier is ISBN-10', async () => {
    const wrapper = mountTab(
      makeBook({
        isbn13: '9780593419113',
        publisher: 'Penguin',
        publishedDate: '2023-04-25',
        language: 'en',
        pageCount: 272,
        genres: ['Cooking'],
        tags: ['Food'],
        description: 'A cookbook',
      }),
    )
    await flushPromises()
    expect(wrapper.find('[aria-label="metadataReminders.missingCount"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('returns focus to the editor when preferences remove the badge that opened the sheet', async () => {
    reminderUser.value.settings.metadataReminderPreferences = { fields: ['isbn'] }
    const wrapper = mountTab(makeBook())
    document.body.append(wrapper.element)
    await flushPromises()
    await wrapper.get('[aria-label="metadataReminders.missingCount"]').trigger('click')
    await flushPromises()
    document.querySelector<HTMLButtonElement>('[data-slot="popover-content"] button')!.click()
    await flushPromises()
    document.querySelector<HTMLInputElement>('[data-slot="sheet-content"] input[value="isbn"]')!.click()
    await flushPromises()
    expect(wrapper.find('[aria-label="metadataReminders.missingCount"]').exists()).toBe(false)
    document.querySelector<HTMLButtonElement>('[data-slot="sheet-content"] [data-slot="sheet-footer"] button')!.click()
    await flushPromises()
    expect(document.activeElement?.getAttribute('tabindex')).toBe('-1')
    expect(wrapper.element.contains(document.activeElement)).toBe(true)
    wrapper.unmount()
  })

  it('does not save the form when a cover fails to save', async () => {
    const wrapper = mountTab(makeBook())
    await flushPromises()
    panel.hasPending.value = true
    panel.pendingMedia.value = ['ebook', 'audio']
    panel.confirm.mockResolvedValue(false)
    await flushPromises()

    await saveButton(wrapper).trigger('click')
    await flushPromises()

    expect(panel.confirm).toHaveBeenCalledWith(['ebook', 'audio'])
    expect(patchCalls()).toHaveLength(0)
  })

  it('writes a cover whose slot the form unlocks only after the form save', async () => {
    const wrapper = mountTab(makeBook({ lockedFields: ['audioCover'] }))
    await flushPromises()
    wrapper.getComponent(CoverEditorPanelStub).vm.$emit('toggleLock', 'audioCover')
    panel.hasPending.value = true
    panel.pendingMedia.value = ['ebook', 'audio']
    savedBook = makeBook({ lockedFields: [] })
    await flushPromises()

    const order: string[] = []
    panel.confirm.mockImplementation(async (media) => {
      order.push(`covers:${(media ?? []).join(',')}`)
      return true
    })
    vi.mocked(api).mockImplementation(async (url, init) => {
      if (init?.method === 'PATCH') {
        order.push('form')
        return json({ book: savedBook, write: null, libraryAutoWriteEnabled: false })
      }
      return json([])
    })

    await saveButton(wrapper).trigger('click')
    await flushPromises()

    expect(order).toEqual(['covers:ebook', 'form', 'covers:audio'])
    expect(JSON.parse(String(patchCalls()[0]![1]!.body)).lockedFields).toEqual([])
  })

  it('clears the unsaved covers with the rest of the form', async () => {
    const wrapper = mountTab(makeBook())
    await flushPromises()
    panel.hasPending.value = true
    await flushPromises()

    await wrapper.get('[aria-label="common.cancel"]').trigger('click')

    expect(panel.reset).toHaveBeenCalledTimes(1)
  })

  it('passes each tile lock from the form, and toggles the one a tile asks for', async () => {
    const wrapper = mountTab(makeBook({ lockedFields: ['cover'] }))
    await flushPromises()

    expect(wrapper.getComponent(CoverEditorPanelStub).props('lockedFields')).toEqual(['cover'])
    wrapper.getComponent(CoverEditorPanelStub).vm.$emit('toggleLock', 'audioCover')
    await flushPromises()

    expect(wrapper.getComponent(CoverEditorPanelStub).props('lockedFields')).toEqual(['cover', 'audioCover'])
  })

  it('checks the audiobook cover lock before applying a searched cover to a book without an ebook', async () => {
    const wrapper = mountTab(makeBook({ coverMedia: ['audio'], lockedFields: ['audioCover'] }))
    await flushPromises()
    await wrapper.get('[aria-label="common.search"]').trigger('click')

    wrapper.getComponent(MetadataSearchDrawerStub).vm.$emit('apply', { formPatch: {}, coverUrl: 'https://example.com/square.jpg' })
    await flushPromises()

    expect(panel.setUrl).not.toHaveBeenCalled()
  })

  it('applies a searched cover to the panel when its slot is unlocked', async () => {
    const wrapper = mountTab(makeBook({ lockedFields: ['audioCover'] }))
    await flushPromises()
    await wrapper.get('[aria-label="common.search"]').trigger('click')

    wrapper.getComponent(MetadataSearchDrawerStub).vm.$emit('apply', { formPatch: {}, coverUrl: 'https://example.com/portrait.jpg' })
    await flushPromises()

    expect(panel.setUrl).toHaveBeenCalledWith('https://example.com/portrait.jpg', 'ebook')
  })

  it('stages each searched cover on its own tile, skipping a locked one', async () => {
    const wrapper = mountTab(makeBook({ coverMedia: ['ebook', 'audio'], lockedFields: ['cover'] }))
    await flushPromises()
    await wrapper.get('[aria-label="common.search"]').trigger('click')

    wrapper
      .getComponent(MetadataSearchDrawerStub)
      .vm.$emit('apply', { formPatch: {}, coverUrl: 'https://example.com/portrait.jpg', audioCoverUrl: 'https://example.com/square.jpg' })
    await flushPromises()

    expect(panel.setUrl).toHaveBeenCalledTimes(1)
    expect(panel.setUrl).toHaveBeenCalledWith('https://example.com/square.jpg', 'audio')
  })

  it('reports a cover change with its medium', async () => {
    const wrapper = mountTab(makeBook())
    await flushPromises()

    wrapper.getComponent(CoverEditorPanelStub).vm.$emit('coverChanged', 'audio')

    expect(wrapper.emitted('coverChanged')).toEqual([['audio']])
  })
})
