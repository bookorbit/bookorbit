import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed } from 'vue'
import FontsSettings from '../FontsSettings.vue'
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

import { FontUploadError, useCustomFonts } from '@/features/reader/epub/composables/useCustomFonts'
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

const georgia = [mockFont(1, 'Georgia'), mockFont(2, 'Georgia', 700)]
const inter = mockFont(4, 'Inter')
const courgette = mockFont(3, 'Courgette')
const bigCaslon = mockFont(5, 'Big Caslon', 500)

const USAGE = {
  fonts: [
    { cssFamily: '__userfont_georgia', books: 2, isDefault: false },
    { cssFamily: '__serverfont_courgette', books: 0, isDefault: true },
  ],
}

function respond(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) })
}

let user: MockFontStore
let customFonts: ReturnType<typeof makeCustomFontsMock>

function mountPage(own = [...georgia, inter], server = [courgette, bigCaslon]): VueWrapper {
  user = makeFontStore('user', own)
  customFonts = makeCustomFontsMock({ user, server: makeFontStore('server', server) })
  vi.mocked(useCustomFonts).mockReturnValue(customFonts as never)
  return mount(FontsSettings, { attachTo: document.body, global: { stubs: DROPDOWN_STUBS } })
}

function rowsIn(wrapper: VueWrapper, section: string) {
  return wrapper.get(`[data-testid="${section}"]`).findAll('[data-testid="font-family-row"]')
}

function rowNamed(wrapper: VueWrapper, section: string, name: string) {
  const row = rowsIn(wrapper, section).find((candidate) => candidate.find('button').text() === name)
  if (!row) throw new Error(`no ${section} row for ${name}`)
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

describe('FontsSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(usePermissions).mockReturnValue({ isDemoRestrictedAccount: computed(() => false) } as never)
    apiMock.mockImplementation((url: string) => (url === '/api/v1/fonts/usage' ? respond(USAGE) : respond({}, false)))
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it("loads the reader's fonts, the server's, their opt-outs and how they use each", async () => {
    mountPage()
    await flushPromises()

    expect(user.fetchFonts).toHaveBeenCalled()
    expect(customFonts.fetchServerFonts).toHaveBeenCalled()
    expect(customFonts.fetchServerFontVisibility).toHaveBeenCalled()
    expect(apiMock).toHaveBeenCalledWith('/api/v1/fonts/usage')
  })

  describe('your fonts', () => {
    it('lists one row per family, in name order, against the personal cap', async () => {
      const wrapper = mountPage()
      await flushPromises()

      expect(rowsIn(wrapper, 'own-fonts').map((row) => row.find('button').text())).toEqual(['Georgia', 'Inter'])
      expect(rowNamed(wrapper, 'own-fonts', 'Georgia').text()).toContain('2 styles, no italics')
      expect(wrapper.get('[data-testid="font-totals"]').text().replace(/\s+/g, ' ')).toContain('3 of 50 files')
    })

    it('says which of them the reader actually uses', async () => {
      const wrapper = mountPage()
      await flushPromises()

      expect(rowNamed(wrapper, 'own-fonts', 'Georgia').get('[data-testid="font-family-use"]').text()).toBe('On 2 books')
      expect(rowNamed(wrapper, 'own-fonts', 'Inter').get('[data-testid="font-family-use"]').text()).toBe('')
    })

    it('keeps the empty state small, since the server list still follows', async () => {
      const wrapper = mountPage([])
      await flushPromises()

      const empty = wrapper.get('[data-testid="font-empty-surface"]')
      expect(empty.text()).toContain('No fonts uploaded yet')
      expect(empty.text()).toContain('Add fonts')
      expect(rowsIn(wrapper, 'server-fonts')).toHaveLength(2)
    })

    it('asks before removing a family, naming the books that lose it', async () => {
      const wrapper = mountPage()
      await flushPromises()

      wrapper
        .findAllComponents(FontFamilyMenu)
        .find((menu) => menu.props('name') === 'Georgia')!
        .vm.$emit('remove', 'Georgia')
      await flushPromises()

      const alert = document.body.querySelector('[role="dialog"] [role="alert"]')?.textContent ?? ''
      expect(alert).toContain('Remove Georgia from your fonts?')
      expect(alert).toContain('It is set on 2 of your books; they go back to their own fonts.')
      expect(user.deleteFont).not.toHaveBeenCalled()

      clickInDialog('Remove family')
      await flushPromises()

      expect(user.deleteFont.mock.calls).toEqual([[1], [2]])
    })

    it('renames a family through the personal route', async () => {
      const wrapper = mountPage()
      await flushPromises()
      apiMock.mockImplementation((url: string) => (url === '/api/v1/fonts/families' ? respond([mockFont(4, 'Inter Display')]) : respond(USAGE)))
      await rowNamed(wrapper, 'own-fonts', 'Inter').trigger('click')
      await flushPromises()

      const input = document.body.querySelector<HTMLInputElement>('#font-family-name')!
      input.value = 'Inter Display'
      input.dispatchEvent(new Event('input'))
      await flushPromises()
      clickInDialog('Save')
      await flushPromises()

      expect(apiMock).toHaveBeenCalledWith('/api/v1/fonts/families', expect.objectContaining({ method: 'PATCH' }))
      expect(toast.success).toHaveBeenCalledWith('Renamed to "Inter Display"')
    })

    it('uploads dropped files into the personal collection and explains the personal cap', async () => {
      const wrapper = mountPage()
      await flushPromises()
      user.uploadFont.mockRejectedValue(new FontUploadError('Maximum of 50 fonts per user reached', 400, 'FONT_LIMIT_REACHED', { limit: 50 }))

      dropFiles([new File(['x'], 'Lora-Regular.ttf')])
      await flushPromises()

      expect(user.uploadFont).toHaveBeenCalledTimes(1)
      expect(wrapper.get('[data-testid="font-upload-entry"]').text()).toContain('You already have 50 font files.')
    })
  })

  describe('server fonts', () => {
    it('lists every server family with a switch, counting how many are shown', async () => {
      const wrapper = mountPage()
      await flushPromises()

      const section = wrapper.get('[data-testid="server-fonts"]')
      expect(rowsIn(wrapper, 'server-fonts').map((row) => row.find('button').text())).toEqual(['Big Caslon', 'Courgette'])
      expect(section.findAll('button[role="switch"]')).toHaveLength(2)
      expect(section.text()).toContain('2 of 2 shown')
    })

    it("shows the reader's own use of a server font, such as being their default", async () => {
      const wrapper = mountPage()
      await flushPromises()

      expect(rowNamed(wrapper, 'server-fonts', 'Courgette').get('[data-testid="font-family-use"]').text()).toBe('Your default')
    })

    it('hides a family when its switch is turned off, and marks the row', async () => {
      const wrapper = mountPage()
      await flushPromises()

      await rowNamed(wrapper, 'server-fonts', 'Big Caslon').get('button[role="switch"]').trigger('click')
      await flushPromises()

      expect(customFonts.setServerFamilyHidden).toHaveBeenCalledWith('Big Caslon', true)
      expect(rowNamed(wrapper, 'server-fonts', 'Big Caslon').text()).toContain('Hidden')
      expect(wrapper.get('[data-testid="server-fonts"]').text()).toContain('1 of 2 shown')
    })

    it('says so when every server font is hidden', async () => {
      const wrapper = mountPage()
      await flushPromises()

      for (const name of ['Big Caslon', 'Courgette']) await rowNamed(wrapper, 'server-fonts', name).get('button[role="switch"]').trigger('click')
      await flushPromises()

      expect(wrapper.text()).toContain('All server fonts are hidden.')
    })

    it('opens a server family to preview, with only its switch to change', async () => {
      const wrapper = mountPage()
      await flushPromises()

      await rowNamed(wrapper, 'server-fonts', 'Courgette').trigger('click')
      await flushPromises()

      expect(dialogText()).toContain('Show in my reader')
      expect(dialogText()).not.toContain('Family name')
      expect(document.body.querySelector('#font-family-name')).toBeNull()

      document.body.querySelector<HTMLButtonElement>('[role="dialog"] button[role="switch"]')!.click()
      await flushPromises()

      expect(customFonts.setServerFamilyHidden).toHaveBeenCalledWith('Courgette', true)
    })

    it('reports a failed save', async () => {
      const wrapper = mountPage()
      await flushPromises()
      customFonts.setServerFamilyHidden.mockResolvedValueOnce(false)

      await rowNamed(wrapper, 'server-fonts', 'Courgette').get('button[role="switch"]').trigger('click')
      await flushPromises()

      expect(toast.error).toHaveBeenCalledWith('Failed to update server font visibility')
    })

    it('leaves the section out when the server has no fonts', async () => {
      const wrapper = mountPage(undefined, [])
      await flushPromises()

      expect(wrapper.find('[data-testid="server-fonts"]').exists()).toBe(false)
    })
  })

  describe('demo restriction', () => {
    beforeEach(() => {
      vi.mocked(usePermissions).mockReturnValue({ isDemoRestrictedAccount: computed(() => true) } as never)
    })

    it('offers nothing that changes the collection but still lets the reader hide server fonts', async () => {
      const wrapper = mountPage()
      await flushPromises()

      expect(wrapper.findAll('button').some((button) => button.text() === 'Add fonts')).toBe(false)
      expect(wrapper.findAllComponents(FontFamilyMenu)).toHaveLength(0)
      expect(wrapper.get('[data-testid="server-fonts"]').findAll('button[role="switch"]')).toHaveLength(2)
    })

    it('ignores dropped files', async () => {
      mountPage()
      await flushPromises()

      dropFiles([new File(['x'], 'Test.ttf')])
      await flushPromises()

      expect(user.uploadFont).not.toHaveBeenCalled()
    })
  })
})
