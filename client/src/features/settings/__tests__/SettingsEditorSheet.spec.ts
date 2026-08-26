import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import SettingsEditorSheet from '../components/SettingsEditorSheet.vue'
import type { EditorMenuAction } from '../lib/editor-actions'

/**
 * The real menu opens on a pointer gesture jsdom does not raise, so its content is rendered flat.
 * What that costs is the open/closed state, which is reka's to get right rather than this file's.
 */
const DROPDOWN_STUBS = {
  DropdownMenu: { template: '<div><slot /></div>' },
  DropdownMenuTrigger: { template: '<div><slot /></div>' },
  DropdownMenuContent: { template: '<div><slot /></div>' },
  DropdownMenuItem: { emits: ['click'], template: '<button @click="$emit(\'click\')"><slot /></button>' },
  DropdownMenuSeparator: { template: '<hr />' },
}

function mountSheet(props: { dirty?: boolean; removable?: boolean; removeConfirm?: string; menuActions?: EditorMenuAction[] } = {}) {
  return mount(SettingsEditorSheet, {
    props: { open: true, title: 'My Prowlarr', description: 'Settings for this indexer.', ...props },
    slots: { default: '<p>form body</p>' },
    global: { stubs: DROPDOWN_STUBS },
  })
}

function textOf(selector: string): string {
  return [...document.body.querySelectorAll(selector)].map((el) => el.textContent ?? '').join(' ')
}

function clickByText(text: string, within: ParentNode = document.body) {
  const button = [...within.querySelectorAll('button')].find((candidate) => (candidate.textContent ?? '').includes(text))
  if (button === undefined) throw new Error(`no button labelled "${text}"`)
  button.click()
}

/** The armed question and its two answers, which is the only place an action is actually run. */
function confirmation(): HTMLElement {
  const question = document.body.querySelector('[role="alert"]')
  if (question?.parentElement == null) throw new Error('nothing is awaiting confirmation')
  return question.parentElement
}

describe('SettingsEditorSheet', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('closes straight away when nothing has been typed', async () => {
    const wrapper = mountSheet({ dirty: false })
    await flushPromises()

    clickByText('Cancel')
    await flushPromises()

    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(textOf('[role="dialog"]')).not.toContain('Discard your changes?')
  })

  /**
   * The inline form it replaces could not lose anything by being scrolled past. A sheet closes on
   * a scrim click and on Escape, so it has to ask before throwing typed changes away.
   */
  it('asks before discarding changes, and only closes once that is confirmed', async () => {
    const wrapper = mountSheet({ dirty: true })
    await flushPromises()

    clickByText('Cancel')
    await flushPromises()

    expect(wrapper.emitted('cancel')).toBeUndefined()
    expect(textOf('[role="dialog"]')).toContain('Discard your changes?')

    clickByText('Discard changes')
    await flushPromises()

    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  it('offers no remove action while there is nothing yet to remove', async () => {
    mountSheet({ removable: false })
    await flushPromises()

    expect(textOf('[role="dialog"]')).not.toContain('Delete')
  })

  /**
   * The question is answered in the footer rather than in a dialog: a dialog over the sheet hides
   * and slides the sheet away, so the record being removed leaves the screen mid-question.
   */
  it('asks in the footer before removing, and says what the removal costs', async () => {
    const wrapper = mountSheet({ removable: true, removeConfirm: 'Delete this source?' })
    await flushPromises()

    clickByText('Delete')
    await flushPromises()

    expect(wrapper.emitted('remove')).toBeUndefined()
    expect(textOf('[role="alert"]')).toContain('Delete this source?')

    clickByText('Delete', confirmation())
    await flushPromises()

    expect(wrapper.emitted('remove')).toHaveLength(1)
  })

  it('removes nothing when the question is dismissed', async () => {
    const wrapper = mountSheet({ removable: true })
    await flushPromises()

    clickByText('Delete')
    await flushPromises()

    clickByText('Cancel', confirmation())
    await flushPromises()

    expect(wrapper.emitted('remove')).toBeUndefined()
    expect(document.body.querySelector('[role="alert"]')).toBeNull()
  })

  /**
   * Anything acting on what the record is built on rather than on the record itself, such as the
   * plugin behind a source. It is one menu so the form keeps a single row of buttons under it.
   */
  it('runs a menu action that asks nothing on the first click', async () => {
    const wrapper = mountSheet({ menuActions: [{ id: 'plugin-update', label: 'Update plugin' }] })
    await flushPromises()

    clickByText('Update plugin')
    await flushPromises()

    expect(wrapper.emitted('action')).toEqual([['plugin-update']])
  })

  it('holds a menu action that asks first until the question is answered', async () => {
    const wrapper = mountSheet({
      menuActions: [
        {
          id: 'plugin-remove',
          label: 'Delete plugin',
          danger: true,
          confirm: 'Delete the Demo plugin?',
          consequence: '1 source and its credential will be permanently deleted.',
        },
      ],
    })
    await flushPromises()

    clickByText('Delete plugin')
    await flushPromises()

    expect(wrapper.emitted('action')).toBeUndefined()
    expect(textOf('[role="alert"]')).toContain('1 source and its credential will be permanently deleted.')

    clickByText('Delete plugin', confirmation())
    await flushPromises()

    expect(wrapper.emitted('action')).toEqual([['plugin-remove']])
  })
})
