import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import type { ChapterPauseWindow } from '@bookorbit/types'
import { setI18nLocale } from '@/i18n'
import { toDraft, type DraftChapter } from '@/features/book/lib/chapter-edit'
import type { AnalyzePauses } from '@/features/book/lib/chapter-snap'
import ChapterSnapDialog from '../ChapterSnapDialog.vue'

const rows = toDraft([
  { title: 'Opening', startMs: 0 },
  { title: 'One', startMs: 60_000 },
  { title: 'Two', startMs: 120_000 },
])

function answer(points: number[], windowMs: number): ChapterPauseWindow[] {
  return points.map((pointMs) => ({
    pointMs,
    fromMs: pointMs - windowMs / 2,
    toMs: pointMs + windowMs / 2,
    pauses: pointMs === 60_000 ? [{ startMs: 58_000, endMs: 61_000 }] : [],
    failed: false,
  }))
}

let wrapper: VueWrapper | null = null

async function open(analyze: AnalyzePauses, selected: string[] = []) {
  await setI18nLocale('en')
  wrapper = mount(ChapterSnapDialog, {
    props: { open: false, rows, selected: new Set(selected), totalDurationMs: 400_000, analyze },
    attachTo: document.body,
  })
  await wrapper.setProps({ open: true })
  await flushPromises()
}

function button(label: string): HTMLButtonElement {
  return [...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  )!
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('ChapterSnapDialog', () => {
  it('finds pauses, says what will move and applies it', async () => {
    const analyze = vi.fn<AnalyzePauses>(async (points, windowMs) => answer(points, windowMs))
    await open(analyze)

    button('Find pauses').click()
    await flushPromises()

    expect(analyze).toHaveBeenCalledWith([60_000, 120_000], 14_000, expect.any(AbortSignal))
    const text = document.body.querySelector('[role="dialog"]')!.textContent
    expect(text).toContain('1 chapter moves, by 0.7 s')
    expect(text).toContain('1 found no pause nearby')

    button('Apply').click()
    await flushPromises()

    const [applied] = wrapper!.emitted('apply')![0] as [DraftChapter[]]
    expect(applied.map((row) => row.startMs)).toEqual([0, 60_700, 120_000])
  })

  it('only listens around the selected chapters when some are selected', async () => {
    const analyze = vi.fn<AnalyzePauses>(async (points, windowMs) => answer(points, windowMs))
    await open(analyze, [rows[2]!.key])

    button('Find pauses').click()
    await flushPromises()

    expect(analyze).toHaveBeenCalledWith([120_000], 14_000, expect.any(AbortSignal))
    expect(document.body.textContent).toContain('No chapter needs to move.')
    expect(button('Apply').disabled).toBe(true)
  })

  it('goes back to the options when stopped part way', async () => {
    let release: (() => void) | null = null
    const analyze = vi.fn<AnalyzePauses>(
      (_points, _windowMs, signal) =>
        new Promise((_, reject) => {
          release = () => reject(new DOMException('Aborted', 'AbortError'))
          signal?.addEventListener('abort', () => release?.())
        }),
    )
    await open(analyze)

    button('Find pauses').click()
    await flushPromises()
    expect(document.body.querySelector('[role="progressbar"]')).not.toBeNull()

    button('Stop').click()
    await flushPromises()

    expect(button('Find pauses')).toBeDefined()
    expect(document.body.querySelector('[role="alert"]')).toBeNull()
    expect(wrapper!.emitted('apply')).toBeUndefined()
  })
})
