import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'

import BulkRenameRunDialog from '../BulkRenameRunDialog.vue'
import SegmentDiff from '../SegmentDiff.vue'
import type { DiffOp } from '../../utils/pathDiff'

/** reka-ui portals on a later tick, so every assertion has to wait for the content to land. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('BulkRenameRunDialog', () => {
  let wrapper: VueWrapper | null = null

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    document.body.innerHTML = ''
  })

  async function mountDialog(props: { open: boolean; done: number; total: number }) {
    wrapper = mount(BulkRenameRunDialog, { props, attachTo: document.body })
    await settle()
    return wrapper
  }

  /**
   * Nothing has moved until the first file reports back. A 0% progress bar through that wait read
   * as a stalled rename, which is what made the dialog feel broken.
   */
  it('shows an indeterminate preparing state before the first file reports', async () => {
    await mountDialog({ open: true, done: 0, total: 8 })
    expect(document.body.textContent).toContain('Preparing')
    expect(document.querySelector('[role="progressbar"]')).toBeNull()
  })

  it('switches to real progress once files start moving', async () => {
    await mountDialog({ open: true, done: 3, total: 8 })
    const bar = document.querySelector('[role="progressbar"]')
    expect(bar).not.toBeNull()
    expect(bar?.getAttribute('aria-valuenow')).toBe('3')
    expect(bar?.getAttribute('aria-valuemax')).toBe('8')
    expect(document.body.textContent).not.toContain('Preparing')
  })

  it('is a named modal dialog', async () => {
    await mountDialog({ open: true, done: 1, total: 2 })
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog?.getAttribute('aria-labelledby')).toBeTruthy()
  })

  it('emits stop from the stop control', async () => {
    const dialog = await mountDialog({ open: true, done: 1, total: 2 })
    const stop = [...document.querySelectorAll('button')].find((button) => /Stop/.test(button.textContent ?? ''))
    stop?.click()
    await settle()
    expect(dialog.emitted('stop')).toBeTruthy()
  })

  it('renders nothing while closed', async () => {
    await mountDialog({ open: false, done: 0, total: 0 })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
})

describe('SegmentDiff', () => {
  const ops: DiffOp[] = [
    { kind: 'eq', value: 'Book' },
    { kind: 'del', value: '  ' },
    { kind: 'ins', value: ' ' },
    { kind: 'eq', value: 'Title' },
  ]

  it('marks runs of spaces with dots so an invisible rename is visible', () => {
    const wrapper = mount(SegmentDiff, { props: { ops } })
    expect(wrapper.text()).toContain('··')
  })

  /**
   * Theme tokens are tuned per theme; compositing alpha over a surface bypasses that tuning and
   * fails contrast in dark mode, so text must never be faded.
   */
  it('never fades text with alpha', () => {
    const wrapper = mount(SegmentDiff, { props: { ops } })
    expect(wrapper.html()).not.toMatch(/opacity-\d/)
  })

  it('renders only the removed side when asked for the from view', () => {
    const wrapper = mount(SegmentDiff, { props: { ops, side: 'from' } })
    expect(wrapper.html()).toContain('text-diff-del')
    expect(wrapper.html()).not.toContain('text-diff-ins')
  })
})
