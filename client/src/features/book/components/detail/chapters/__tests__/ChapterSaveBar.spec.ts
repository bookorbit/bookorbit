import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import type { BookChapterWriteBack } from '@bookorbit/types'
import { setI18nLocale } from '@/i18n'
import ChapterSaveBar from '../ChapterSaveBar.vue'

const AVAILABLE: BookChapterWriteBack = { available: true, reason: null, fileCount: 3 }

let wrapper: VueWrapper | null = null

async function mountBar(props: { dirty?: boolean; writeBack?: BookChapterWriteBack | null; writing?: boolean } = {}) {
  await setI18nLocale('en')
  wrapper = mount(ChapterSaveBar, {
    props: {
      lock: true,
      dirty: props.dirty ?? false,
      errorCount: 0,
      warningCount: 0,
      saving: false,
      canUndo: false,
      canRedo: false,
      writeBack: props.writeBack === undefined ? AVAILABLE : props.writeBack,
      writing: props.writing ?? false,
    },
    attachTo: document.body,
  })
  await flushPromises()
}

async function openMenu() {
  await wrapper!.get('button[aria-label="More save options"]').trigger('keydown', { key: 'Enter' })
  await flushPromises()
}

function item(label: string): HTMLElement {
  return [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((candidate) => candidate.textContent?.trim() === label)!
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('ChapterSaveBar write to files', () => {
  it('offers saving and writing together while there are unsaved changes', async () => {
    await mountBar({ dirty: true })
    await openMenu()

    expect(item('Save and write to files').hasAttribute('data-disabled')).toBe(false)
    expect(item('Write saved chapters to files').hasAttribute('data-disabled')).toBe(true)

    item('Save and write to files').click()
    await flushPromises()

    expect(wrapper!.emitted('saveAndWrite')).toHaveLength(1)
  })

  it('offers writing the saved list once everything is saved', async () => {
    await mountBar()
    await openMenu()

    item('Write saved chapters to files').click()
    await flushPromises()

    expect(wrapper!.emitted('writeFiles')).toHaveLength(1)
  })

  it('says why writing is not possible and keeps both actions off', async () => {
    await mountBar({ dirty: true, writeBack: { available: false, reason: 'format_not_supported', fileCount: 2 } })
    await openMenu()

    expect(item('Save and write to files').hasAttribute('data-disabled')).toBe(true)
    expect(item('Write saved chapters to files').hasAttribute('data-disabled')).toBe(true)
    expect(document.body.textContent).toContain('Only M4B, M4A and MP3 can.')
  })

  it('reports a write in progress and holds the menu shut', async () => {
    await mountBar({ writing: true })

    expect(wrapper!.get('[role="status"]').text()).toBe('Writing chapters into the audio files...')
    expect(wrapper!.get('button[aria-label="More save options"]').attributes('disabled')).toBeDefined()
  })
})
