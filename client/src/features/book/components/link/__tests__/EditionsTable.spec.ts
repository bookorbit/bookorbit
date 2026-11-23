import { beforeEach, describe, expect, it } from 'vitest'
import { mount, RouterLinkStub } from '@vue/test-utils'
import type { LinkedBookSummary } from '@bookorbit/types'
import { i18n } from '@/i18n'
import EditionsTable from '../EditionsTable.vue'
import type { EditionEntry } from '@/features/book/lib/book-editions'

function entry(bookId: number, label: string, extra: Partial<LinkedBookSummary> = {}, current = false): EditionEntry {
  return {
    label,
    current,
    summary: {
      bookId,
      libraryId: 1,
      libraryName: 'Novels',
      title: 'The Lantern Keeper',
      formats: ['epub'],
      mediaKind: 'ebook',
      status: 'present',
      isLead: false,
      ...extra,
    },
  }
}

const menuStubs = {
  RouterLink: RouterLinkStub,
  DropdownMenu: { template: '<div><slot /></div>' },
  DropdownMenuTrigger: { template: '<div><slot /></div>' },
  DropdownMenuContent: { template: '<div data-testid="menu"><slot /></div>' },
  DropdownMenuItem: { emits: ['select'], template: '<div role="menuitem" @click="$emit(\'select\')"><slot /></div>' },
  DropdownMenuSeparator: { template: '<hr />' },
}

const lantern = [
  entry(1, 'First edition', {
    isLead: true,
    formats: ['epub', 'pdf'],
    publishedYear: 2016,
    publisher: 'Harbor & Finch Press',
    progress: { percentage: 100, finished: true },
    lastReadAt: '2025-01-18T20:08:00.000Z',
  }),
  entry(
    2,
    'Unabridged',
    {
      libraryName: 'Audiobooks',
      formats: ['m4b'],
      mediaKind: 'audiobook',
      publishedYear: 2018,
      narrators: ['Ellen Marsh'],
      progress: { percentage: 42, finished: false },
    },
    true,
  ),
  entry(3, 'Spanish translation', { title: 'El guardián del farol', publishedYear: 2021, publisher: 'Ediciones Brisa' }),
  entry(4, 'Full-cast dramatization', {
    libraryName: 'Audiobooks',
    formats: ['m4b'],
    mediaKind: 'audiobook',
    narrators: ['Daniel Price', 'Moira Quinn', 'Fred Calloway'],
  }),
  entry(5, 'Lost copy', { status: 'missing', progress: { percentage: 30, finished: false } }),
]

function mountTable(props: { editions?: EditionEntry[]; canMakeMain?: boolean; removableBookIds?: number[] } = {}) {
  return mount(EditionsTable, { props: { editions: lantern, ...props }, global: { stubs: menuStubs } })
}

describe('EditionsTable', () => {
  beforeEach(() => {
    i18n.global.locale.value = 'en'
  })

  it('lists every edition in the order given, each opening its own page, the viewed one and the main one marked', () => {
    const wrapper = mountTable()
    const rows = wrapper.findAll('[data-testid="edition-row"]')
    expect(rows.map((row) => row.get('[data-testid="edition-row-link"]').text())).toEqual([
      'First edition',
      'Unabridged',
      'Spanish translation',
      'Full-cast dramatization',
      'Lost copy',
    ])
    expect(wrapper.findAll('[data-testid="edition-row-link"]').map((link) => link.findComponent(RouterLinkStub).props('to'))).toEqual(
      [1, 2, 3, 4, 5].map((bookId) => ({ name: 'book-detail', params: { bookId } })),
    )
    expect(rows[1]!.get('[data-testid="edition-row-link"]').attributes('aria-current')).toBe('page')
    expect(rows[0]!.get('[data-testid="edition-row-link"]').attributes('aria-current')).toBeUndefined()
    expect(rows.map((row) => row.find('[data-testid="edition-row-main"]').exists())).toEqual([true, false, false, false, false])
    expect(rows.map((row) => row.find('[data-testid="edition-row-viewing"]').exists())).toEqual([false, true, false, false, false])
    expect(rows[1]!.get('[data-testid="edition-row-link"]').attributes('aria-label')).toBe('Unabridged, M4B, in Audiobooks, 42% read')
  })

  it('draws a plain cover in place of one that does not load', async () => {
    const wrapper = mountTable()
    const covers = () => wrapper.findAll('[data-testid="edition-row-cover"]')
    expect(covers().every((cover) => cover.find('img').exists())).toBe(true)

    await covers()[2]!.get('img').trigger('error')
    expect(covers().map((cover) => cover.find('img').exists())).toEqual([true, true, false, true, true])
  })

  it('names each library, with the title first when an edition has another one', () => {
    const rows = mountTable().findAll('[data-testid="edition-row"]')
    expect(rows[0]!.text()).toContain('Novels')
    expect(rows[2]!.text()).toContain('El guardián del farol · Novels')
    expect(rows[0]!.text()).not.toContain('The Lantern Keeper ·')
  })

  it('shows year, publisher and narrators, two by name and a count for the rest', () => {
    const rows = mountTable().findAll('[data-testid="edition-row"]')
    expect(rows[0]!.text()).toContain('2016')
    expect(rows[0]!.text()).toContain('Harbor & Finch Press')
    expect(rows[0]!.text()).toContain('Not narrated')
    expect(rows[1]!.text()).toContain('Ellen Marsh')
    expect(rows[3]!.text()).toContain('Daniel Price, Moira Quinn')
    expect(rows[3]!.text()).toContain('+1 more')
    expect(rows[3]!.text()).not.toContain('Fred Calloway')
  })

  it('tells this reader where they are in each edition', () => {
    const rows = mountTable().findAll('[data-testid="edition-row"]')
    expect(rows[0]!.text()).toContain('Finished')
    expect(rows[0]!.text()).toContain('Jan 2025')
    expect(rows[1]!.text()).toContain('Reading · 42%')
    expect(rows[2]!.text()).toContain('Not started')
    expect(rows[4]!.text()).toContain('Files missing')
    expect(rows[4]!.text()).not.toContain('30%')
  })

  it('offers each row only the actions this viewer may take', () => {
    const rows = mountTable({ canMakeMain: true, removableBookIds: [2, 3] }).findAll('[data-testid="edition-row"]')
    const items = (index: number) => ({
      open: rows[index]!.find('[data-testid="edition-row-open"]').exists(),
      makeMain: rows[index]!.find('[data-testid="edition-row-make-main"]').exists(),
      remove: rows[index]!.find('[data-testid="edition-row-remove"]').exists(),
    })
    expect(items(0)).toEqual({ open: true, makeMain: false, remove: false })
    expect(items(1)).toEqual({ open: false, makeMain: true, remove: true })
    expect(items(2)).toEqual({ open: true, makeMain: true, remove: true })
    expect(rows[2]!.get('[data-testid="edition-row-actions"]').attributes('aria-label')).toBe('Actions for Spanish translation')
  })

  it('draws no menu on a row with nothing to offer', () => {
    const rows = mountTable({ editions: [entry(1, 'Main', { isLead: true }), entry(2, 'This one', {}, true)] }).findAll('[data-testid="edition-row"]')
    expect(rows[0]!.find('[data-testid="edition-row-actions"]').exists()).toBe(true)
    expect(rows[1]!.find('[data-testid="edition-row-actions"]').exists()).toBe(false)
  })

  it('asks the page to make an edition main or remove it', async () => {
    const wrapper = mountTable({ canMakeMain: true, removableBookIds: [3] })
    const spanish = wrapper.findAll('[data-testid="edition-row"]')[2]!
    await spanish.get('[data-testid="edition-row-make-main"]').trigger('click')
    await spanish.get('[data-testid="edition-row-remove"]').trigger('click')
    expect(wrapper.emitted('make-main')).toEqual([[3]])
    expect(wrapper.emitted('remove')).toEqual([[3]])
  })
})
