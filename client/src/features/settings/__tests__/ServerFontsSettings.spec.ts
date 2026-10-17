import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed } from 'vue'
import ServerFontsSettings from '../ServerFontsSettings.vue'
import FontFamilyMenu from '../fonts/components/FontFamilyMenu.vue'
import { makeCustomFontsMock, makeFontStore, mockFont, type MockFontStore } from './font-store-fixture'

const apiMock = vi.hoisted(() => vi.fn<(input: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>())
vi.mock('@/lib/api', () => ({ api: apiMock }))

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn<() => void>(), error: vi.fn<() => void>() },
}))

vi.mock('@/features/reader/epub/composables/useCustomFonts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/reader/epub/composables/useCustomFonts')>()),
  useCustomFonts: vi.fn<() => unknown>(),
}))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: vi.fn<() => unknown>(),
}))

vi.mock('../SettingsPageHeader.vue', () => ({
  default: { template: '<div />' },
}))

import { useCustomFonts } from '@/features/reader/epub/composables/useCustomFonts'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { toast } from 'vue-sonner'

/** The real menus open on a pointer gesture jsdom does not raise, so their content is rendered flat. */
const DROPDOWN_STUBS = {
  DropdownMenu: { template: '<div><slot /></div>' },
  DropdownMenuTrigger: { template: '<div><slot /></div>' },
  DropdownMenuContent: { template: '<div><slot /></div>' },
  DropdownMenuItem: { emits: ['click'], template: '<button type="button" @click="$emit(\'click\')"><slot /></button>' },
  DropdownMenuSeparator: { template: '<hr />' },
}

const bigCaslon = mockFont(2, 'Big Caslon', 500)
const courgette = mockFont(3, 'Courgette')
const literata = [mockFont(8, 'Literata'), mockFont(9, 'Literata', 700)]

const USAGE = {
  families: [
    { familyName: 'Big Caslon', books: 0, readers: 0, defaults: 0, hidden: 1 },
    { familyName: 'Courgette', books: 2, readers: 1, defaults: 0, hidden: 0 },
    { familyName: 'Literata', books: 0, readers: 0, defaults: 0, hidden: 0 },
  ],
}

function respond(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) })
}

let store: MockFontStore

function mountPage(fonts = [courgette, ...literata, bigCaslon]): VueWrapper {
  store = makeFontStore('server', fonts)
  vi.mocked(useCustomFonts).mockReturnValue(makeCustomFontsMock({ server: store }) as never)
  return mount(ServerFontsSettings, { props: { embedded: true }, attachTo: document.body, global: { stubs: DROPDOWN_STUBS } })
}

function rowNamed(wrapper: VueWrapper, name: string) {
  const row = wrapper.findAll('[data-testid="font-family-row"]').find((candidate) => candidate.find('button').text() === name)
  if (!row) throw new Error(`no row for ${name}`)
  return row
}

function dialogText(): string {
  return document.body.querySelector('[role="dialog"]')?.textContent ?? ''
}

function clickInDialog(text: string) {
  const dialog = document.body.querySelector('[role="dialog"]')
  const button = [...(dialog?.querySelectorAll('button') ?? [])].find((candidate) => (candidate.textContent ?? '').trim() === text)
  if (!button) throw new Error(`no "${text}" button in the sheet`)
  button.click()
}

/** jsdom has no DragEvent, so a drop is an Event carrying the one field the page reads. */
function dropFiles(files: File[]) {
  const event = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files, items: files } })
  window.dispatchEvent(event)
}

describe('ServerFontsSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(usePermissions).mockReturnValue({ isDemoRestrictedAccount: computed(() => false) } as never)
    apiMock.mockImplementation((url: string) => (url.endsWith('/usage') ? respond(USAGE) : respond({}, false)))
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  describe('loading', () => {
    it('loads the server collection and how readers use it', async () => {
      mountPage()
      await flushPromises()

      expect(vi.mocked(useCustomFonts).mock.results[0]!.value.scopeStore).toHaveBeenCalledWith('server')
      expect(store.fetchFonts).toHaveBeenCalled()
      expect(apiMock).toHaveBeenCalledWith('/api/v1/server-fonts/usage')
    })

    it('shows the empty state with its own Add fonts button when the server has no fonts', async () => {
      const wrapper = mountPage([])
      await flushPromises()

      const empty = wrapper.get('[data-testid="font-empty-surface"]')
      expect(empty.text()).toContain('No server fonts yet')
      expect(empty.text()).toContain('Add fonts')
      expect(wrapper.find('[data-testid="font-list-surface"]').exists()).toBe(false)
    })
  })

  describe('ledger', () => {
    it('lists one row per family, in name order, each set in its own face', async () => {
      const wrapper = mountPage()
      await flushPromises()

      const names = wrapper.findAll('[data-testid="font-family-row"]').map((row) => row.find('button').text())
      expect(names).toEqual(['Big Caslon', 'Courgette', 'Literata'])
      expect(rowNamed(wrapper, 'Literata').find('button').attributes('style')).toContain('__serverfont_literata')
    })

    it('says what each family gives readers instead of how many files it has', async () => {
      const wrapper = mountPage()
      await flushPromises()

      expect(rowNamed(wrapper, 'Big Caslon').text()).toContain('Medium only')
      expect(rowNamed(wrapper, 'Literata').text()).toContain('2 styles, no italics')
    })

    it('shows reader use only where there is some', async () => {
      const wrapper = mountPage()
      await flushPromises()

      expect(rowNamed(wrapper, 'Courgette').get('[data-testid="font-family-use"]').text()).toBe('On 2 books')
      expect(rowNamed(wrapper, 'Big Caslon').get('[data-testid="font-family-use"]').text()).toBe('Hidden by 1 reader')
      expect(rowNamed(wrapper, 'Literata').get('[data-testid="font-family-use"]').text()).toBe('')
    })

    it('counts families and files separately, against the server cap', async () => {
      const wrapper = mountPage()
      await flushPromises()

      const totals = wrapper.get('[data-testid="font-totals"]').text().replace(/\s+/g, ' ')
      expect(totals).toContain('3 families')
      expect(totals).toContain('4 of 200 files')
    })

    it('sets the preview text in every row', async () => {
      const wrapper = mountPage()
      await flushPromises()

      await wrapper.get('input[type="text"]').setValue('Sphinx of black quartz')

      expect(wrapper.findAll('[data-testid="font-family-row"] p').every((p) => p.text() === 'Sphinx of black quartz')).toBe(true)
    })

    it('filters families by name and says when none match', async () => {
      const wrapper = mountPage()
      await flushPromises()

      await wrapper.get('input[type="search"]').setValue('lit')
      expect(wrapper.findAll('[data-testid="font-family-row"]')).toHaveLength(1)

      await wrapper.get('input[type="search"]').setValue('zzz')
      expect(wrapper.text()).toContain('No families match “zzz”')
    })
  })

  describe('uploads', () => {
    it('uploads files dropped anywhere on the page and lists where each one went', async () => {
      const wrapper = mountPage()
      await flushPromises()
      store.uploadFont.mockResolvedValue({
        font: mockFont(20, 'Caudex'),
        suggestedFamilyName: 'Caudex',
        suggestedWeight: 400,
        suggestedStyle: 'normal',
      })

      dropFiles([new File(['x'], 'Caudex-Regular.ttf'), new File(['x'], 'reading-notes.pdf')])
      await flushPromises()

      expect(store.uploadFont).toHaveBeenCalledTimes(1)
      const entries = wrapper.findAll('[data-testid="font-upload-entry"]').map((entry) => entry.text().replace(/\s+/g, ' '))
      expect(entries[0]).toContain('Caudex-Regular.ttf')
      expect(entries[0]).toContain('Regular · new family')
      expect(entries[0]).toContain('Added')
      expect(entries[1]).toContain('Not a font file. Use TTF, OTF, WOFF or WOFF2.')
      expect(toast.success).not.toHaveBeenCalled()
    })
  })

  describe('family sheet', () => {
    it('opens the family when its row is clicked', async () => {
      const wrapper = mountPage()
      await flushPromises()

      await rowNamed(wrapper, 'Literata').trigger('click')
      await flushPromises()

      expect(dialogText()).toContain('Literata')
      expect(dialogText()).toContain('In the reader')
      expect(document.body.querySelectorAll('[data-testid="font-family-file"]')).toHaveLength(2)
    })

    it('opens with the removal already asked when chosen from the row menu, naming what it costs', async () => {
      const wrapper = mountPage()
      await flushPromises()

      wrapper
        .findAllComponents(FontFamilyMenu)
        .find((menu) => menu.props('name') === 'Courgette')!
        .vm.$emit('remove', 'Courgette')
      await flushPromises()

      const alert = document.body.querySelector('[role="dialog"] [role="alert"]')?.textContent ?? ''
      expect(alert).toContain('Remove Courgette for every reader?')
      expect(alert).toContain("It is set on 2 books by 1 reader; those books go back to the book's own font.")
      expect(store.deleteFont).not.toHaveBeenCalled()
    })

    it('removes every file of the family once confirmed', async () => {
      const wrapper = mountPage()
      await flushPromises()
      wrapper
        .findAllComponents(FontFamilyMenu)
        .find((menu) => menu.props('name') === 'Literata')!
        .vm.$emit('remove', 'Literata')
      await flushPromises()

      clickInDialog('Remove family')
      await flushPromises()

      expect(store.deleteFont.mock.calls).toEqual([[8], [9]])
      expect(toast.success).toHaveBeenCalledWith('Literata removed')
    })

    it('renames the whole family in one request', async () => {
      const wrapper = mountPage()
      await flushPromises()
      apiMock.mockImplementation((url: string) => (url.endsWith('/families') ? respond([mockFont(3, 'Courgette Script')]) : respond(USAGE)))
      await rowNamed(wrapper, 'Courgette').trigger('click')
      await flushPromises()

      const input = document.body.querySelector<HTMLInputElement>('#font-family-name')!
      input.value = 'Courgette Script'
      input.dispatchEvent(new Event('input'))
      await flushPromises()
      expect(dialogText()).toContain('A new name sends the 2 books that use it back to the book’s own font.')

      clickInDialog('Save')
      await flushPromises()

      expect(apiMock).toHaveBeenCalledWith('/api/v1/server-fonts/families', expect.objectContaining({ method: 'PATCH' }))
      expect(toast.success).toHaveBeenCalledWith('Renamed to "Courgette Script"')
    })

    it('warns that a new name shows the family again to readers who hid it', async () => {
      const wrapper = mountPage()
      await flushPromises()
      await rowNamed(wrapper, 'Big Caslon').trigger('click')
      await flushPromises()

      const input = document.body.querySelector<HTMLInputElement>('#font-family-name')!
      input.value = 'Caslon'
      input.dispatchEvent(new Event('input'))
      await flushPromises()

      expect(dialogText()).toContain('1 reader hid Big Caslon; a new name shows it to them again.')
    })
  })

  describe('demo restriction', () => {
    beforeEach(() => {
      vi.mocked(usePermissions).mockReturnValue({ isDemoRestrictedAccount: computed(() => true) } as never)
    })

    it('keeps the list readable but offers nothing that changes it', async () => {
      const wrapper = mountPage()
      await flushPromises()

      expect(wrapper.text()).toContain('Courgette')
      expect(wrapper.findAll('button').some((button) => button.text() === 'Add fonts')).toBe(false)
      expect(wrapper.findAll('button').some((button) => button.text().includes('Remove family'))).toBe(false)
    })

    it('ignores dropped files', async () => {
      mountPage()
      await flushPromises()

      dropFiles([new File(['x'], 'Test.ttf')])
      await flushPromises()

      expect(store.uploadFont).not.toHaveBeenCalled()
    })
  })
})
