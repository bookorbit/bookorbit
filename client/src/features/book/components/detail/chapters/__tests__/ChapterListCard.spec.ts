import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { setI18nLocale } from '@/i18n'
import { toDraft } from '@/features/book/lib/chapter-edit'
import ChapterListCard from '../ChapterListCard.vue'

vi.mock('@tanstack/vue-virtual', async () => {
  const { computed } = await import('vue')
  return {
    useVirtualizer: (options: { value: { count: number } }) =>
      computed(() => ({
        getVirtualItems: () => Array.from({ length: options.value.count }, (_, index) => ({ index, key: index, start: index * 46 })),
        getTotalSize: () => options.value.count * 46,
        measure: vi.fn<() => void>(),
        measureElement: vi.fn<(element: Element) => void>(),
        scrollToIndex: vi.fn<() => void>(),
      })),
  }
})
let wrapper: VueWrapper<InstanceType<typeof ChapterListCard>> | null = null
async function setup(options: { editing?: boolean; active?: number; listeningMs?: number | null } = {}) {
  await setI18nLocale('en')
  const rows = toDraft([
    { title: 'First', startMs: 0 },
    { title: 'Second', startMs: 10_000 },
    { title: 'Third', startMs: 20_000 },
  ])
  wrapper = mount(ChapterListCard, {
    props: {
      rows,
      editing: options.editing ?? true,
      activeKey: rows[options.active ?? 0].key,
      selected: new Set<string>(),
      issuesByKey: new Map(),
      totalDurationMs: 30_000,
      listeningMs: options.listeningMs ?? null,
    },
  })
  return wrapper
}
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})
describe('ChapterListCard pending starts', () => {
  it('commits the focused timestamp before save without requiring blur', async () => {
    const view = await setup()
    await view.findAll('input[inputmode="decimal"]')[1].setValue('0:12.500')
    expect(view.emitted('commitStart')).toBeUndefined()
    expect(view.vm.commitPendingStarts()).toBe(true)
    expect(view.emitted('commitStart')?.[0]).toEqual([view.props('rows')[1].key, 12_500])
  })
  it('blocks saving invalid pending text and permits saving after correction', async () => {
    const view = await setup()
    const input = view.findAll('input[inputmode="decimal"]')[1]
    await input.setValue('unfinished')
    expect(view.vm.commitPendingStarts()).toBe(false)
    expect(view.emitted('commitStart')).toBeUndefined()
    await input.setValue('0:12')
    expect(view.vm.commitPendingStarts()).toBe(true)
    expect(view.emitted('commitStart')?.[0]?.[1]).toBe(12_000)
  })
})

describe('ChapterListCard rows', () => {
  it('leaves editing rows to their fields: no buttons, and nothing opens inside the list', async () => {
    const view = await setup({ active: 1 })

    expect(view.findAll('[data-row-key]')).toHaveLength(3)
    expect(view.findAll('[data-row-key] button')).toHaveLength(0)
    expect(view.findAll('[role="listitem"]').map((item) => item.findAll(':scope > *').length)).toEqual([1, 1, 1])
  })

  it('makes a pressed or focused row the active one, and leaves the active row alone', async () => {
    const view = await setup({ active: 0 })
    const keys = view.props('rows').map((row) => row.key)
    const rows = view.findAll('[data-row-key]')

    await rows[2]!.trigger('pointerdown')
    await view.setProps({ activeKey: keys[2] })
    await rows[2]!.find('.cell-title').trigger('focusin')
    await rows[0]!.find('.cell-title').trigger('focusin')

    expect(view.emitted('activate')).toEqual([[keys[2]], [keys[0]]])
  })

  it('makes each listening row a button that opens the reader at its start', async () => {
    const view = await setup({ editing: false, listeningMs: 12_000 })

    const rows = view.findAll('[role="listitem"] > button')
    expect(rows).toHaveLength(3)
    expect(rows[1]!.attributes('aria-current')).toBe('true')
    expect(rows[1]!.text()).toContain('You are here')
    expect(rows[1]!.text()).toContain('0:08 left')

    await rows[2]!.trigger('click')
    expect(view.emitted('listen')).toEqual([[20_000]])
  })
})
