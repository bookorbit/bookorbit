import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { setI18nLocale } from '@/i18n'
import { toDraft } from '@/features/book/lib/chapter-edit'
import ChapterToolDialog from '../ChapterToolDialog.vue'

const rows = toDraft([
  { title: 'track 1', startMs: 0 },
  { title: 'track 2', startMs: 10_000 },
  { title: 'track 3', startMs: 20_000 },
])

let wrapper: VueWrapper | null = null

async function open(tool: 'shift' | 'renumber' | 'replace' | 'mergeShort', selected: string[] = []) {
  await setI18nLocale('en')
  wrapper = mount(ChapterToolDialog, {
    props: { open: false, tool, rows, selected: new Set(selected), activeIndex: 1, totalDurationMs: 30_000 },
    attachTo: document.body,
  })
  await wrapper.setProps({ open: true })
  await flushPromises()
}

function field(index = 0): HTMLInputElement {
  return document.body.querySelectorAll<HTMLInputElement>('[role="dialog"] input')[index]!
}

function applyButton(): HTMLButtonElement {
  return [...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent?.trim() === 'Apply')!
}

async function type(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('input'))
  await flushPromises()
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('ChapterToolDialog', () => {
  it('shifts every chapter but the one at 0 and says how many will move', async () => {
    await open('shift')
    await type(field(), '1.5')

    expect(document.body.textContent).toContain('2 chapters will change.')
    applyButton().click()
    await flushPromises()

    const [applied] = wrapper!.emitted('apply')![0] as [typeof rows]
    expect(applied.map((row) => row.startMs)).toEqual([0, 11_500, 21_500])
  })

  it('offers the selection by default once rows are selected', async () => {
    await open('renumber', [rows[2]!.key])

    applyButton().click()
    await flushPromises()

    const [applied] = wrapper!.emitted('apply')![0] as [typeof rows]
    expect(applied.map((row) => row.title)).toEqual(['track 1', 'track 2', 'Chapter 1'])
  })

  it('refuses a broken regular expression instead of applying it', async () => {
    await open('replace')
    await type(field(0), '(')
    const regex = document.body.querySelectorAll<HTMLInputElement>('[role="dialog"] input[type="checkbox"]')[0]!
    regex.click()
    await flushPromises()

    expect(document.body.textContent).toContain('That regular expression is not valid.')
    expect(applyButton().disabled).toBe(true)
  })

  it('cannot apply a change that changes nothing', async () => {
    await open('mergeShort')

    expect(document.body.textContent).toContain('Nothing would change.')
    expect(applyButton().disabled).toBe(true)
  })
})
