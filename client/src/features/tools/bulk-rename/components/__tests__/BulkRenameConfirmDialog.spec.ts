import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'

import BulkRenameConfirmDialog from '../BulkRenameConfirmDialog.vue'

/** reka-ui portals on a later tick, so every assertion has to wait for the content to land. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('BulkRenameConfirmDialog', () => {
  let wrapper: VueWrapper | null = null

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    document.body.innerHTML = ''
  })

  async function mountDialog(overrides: Record<string, unknown> = {}) {
    wrapper = mount(BulkRenameConfirmDialog, {
      props: {
        open: true,
        libraryName: 'Novels',
        renameCount: 10,
        skippedCount: 0,
        heldBackCount: 0,
        cannotRenameCount: 0,
        untouchedCount: 5,
        ...overrides,
      },
      attachTo: document.body,
    })
    await settle()
    return wrapper
  }

  it('renders nothing while closed', async () => {
    await mountDialog({ open: false })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('is a real modal dialog with an accessible name and description', async () => {
    await mountDialog()
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.getAttribute('aria-labelledby')).toBeTruthy()
    expect(dialog?.getAttribute('aria-describedby')).toBeTruthy()
  })

  it('accounts for books that cannot be renamed at all', async () => {
    await mountDialog({ cannotRenameCount: 3 })
    expect(document.body.textContent).toContain('Cannot be renamed')
  })

  it('hides the cannot-rename row when no book is in that state', async () => {
    await mountDialog({ cannotRenameCount: 0 })
    expect(document.body.textContent).not.toContain('Cannot be renamed')
  })

  /**
   * The dialog is the last thing a reviewer sees before files move, so its numbers must add up to
   * the library. Omitting a status silently loses books from that reconciliation.
   */
  it('discloses every book in the library across its rows', async () => {
    await mountDialog({ renameCount: 10, skippedCount: 4, heldBackCount: 3, cannotRenameCount: 2, untouchedCount: 6 })
    const numbers = [...document.querySelectorAll('dd')].map((node) => Number(node.textContent?.trim()))
    expect(numbers).toEqual([10, 4, 3, 2, 6])
    expect(numbers.reduce((sum, value) => sum + value, 0)).toBe(25)
  })

  it('emits confirm and cancel from its actions', async () => {
    const dialog = await mountDialog()
    const buttons = [...document.querySelectorAll('button')]
    buttons.find((button) => /Cancel/.test(button.textContent ?? ''))?.click()
    buttons.find((button) => /Rename/.test(button.textContent ?? ''))?.click()
    await settle()

    expect(dialog.emitted('cancel')).toBeTruthy()
    expect(dialog.emitted('confirm')).toBeTruthy()
  })
})
