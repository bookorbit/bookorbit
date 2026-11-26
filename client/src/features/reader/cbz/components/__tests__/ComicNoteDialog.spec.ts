import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key) }),
}))

import ComicNoteDialog from '../ComicNoteDialog.vue'

let wrapper: VueWrapper | null = null

function mountDialog(props: Partial<InstanceType<typeof ComicNoteDialog>['$props']> = {}) {
  wrapper = mount(ComicNoteDialog, {
    attachTo: document.body,
    props: {
      mode: 'add',
      pages: [4],
      initialPage: 4,
      initialColor: '#FACC15',
      bookTitle: 'Lantern Coast #3',
      thumbnailUrl: (page: number) => `/thumb/${page}`,
      ...props,
    },
  })
  return wrapper
}

function dialog() {
  return document.body.querySelector<HTMLElement>('[data-testid="comic-note-dialog"]')!
}

function saveButton() {
  return dialog().querySelector<HTMLButtonElement>('[data-testid="comic-note-save"]')!
}

async function type(text: string) {
  const textarea = dialog().querySelector('textarea')!
  textarea.value = text
  textarea.dispatchEvent(new Event('input'))
  await nextTick()
  return textarea
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

describe('ComicNoteDialog', () => {
  it('names the single page it adds to and only saves a note with words in it', async () => {
    const view = mountDialog()
    await nextTick()

    expect(dialog().textContent).toContain('reader.cbz.notes.addTitle')
    expect(dialog().textContent).toContain('reader.cbz.notes.page:{"page":5}')
    expect(dialog().querySelectorAll('input[name="comic-note-page"]')).toHaveLength(0)
    expect(saveButton().disabled).toBe(true)

    await type('   ')
    expect(saveButton().disabled).toBe(true)

    await type('  The lighthouse again  ')
    saveButton().click()
    await nextTick()

    expect(view.emitted('save')).toEqual([[{ page: 4, note: 'The lighthouse again', color: '#FACC15' }]])
  })

  it('asks which page of a spread the note goes on and saves with the keyboard shortcut', async () => {
    const view = mountDialog({ pages: [6, 7], initialPage: 7 })
    await nextTick()

    const pages = dialog().querySelectorAll<HTMLInputElement>('input[name="comic-note-page"]')
    expect(pages).toHaveLength(2)
    expect(pages[1]!.checked).toBe(true)
    pages[0]!.click()

    const pink = dialog().querySelector<HTMLInputElement>('input[aria-label="annotations.colors.pink"]')!
    pink.click()

    const textarea = await type('Spread opener')
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))
    await nextTick()

    expect(view.emitted('save')).toEqual([[{ page: 6, note: 'Spread opener', color: '#F472B6' }]])
  })

  it('keeps a colour that is not in the palette when editing', async () => {
    mountDialog({ mode: 'edit', initialNote: 'From the device', initialColor: '#FF3300' })
    await nextTick()

    expect(dialog().textContent).toContain('reader.cbz.notes.editTitle')
    expect(dialog().querySelector('textarea')!.value).toBe('From the device')
    const swatches = dialog().querySelectorAll<HTMLInputElement>('input[name="comic-note-color"]')
    expect(swatches).toHaveLength(11)
    expect(swatches[0]!.value).toBe('#FF3300')
    expect(swatches[0]!.checked).toBe(true)
    expect(saveButton().disabled).toBe(false)
  })

  it('hands focus back to whatever opened it when it closes', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()

    const view = mountDialog()
    await nextTick()
    expect(document.activeElement).toBe(dialog().querySelector('textarea'))

    view.unmount()
    wrapper = null
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(document.activeElement).toBe(opener)
  })

  it('cannot be saved or dismissed while a save is in flight', async () => {
    const view = mountDialog({ initialNote: 'Saving', saving: true })
    await nextTick()

    expect(saveButton().disabled).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(view.emitted('cancel')).toBeUndefined()
  })
})
