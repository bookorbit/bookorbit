import { mount } from '@vue/test-utils'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { nextTick } from 'vue'
import SelectionActionBar from '../SelectionActionBar.vue'
import { BOOK_LINK_MAX_MEMBERS, BOOK_MERGE_MAX_BOOKS } from '@bookorbit/types'
import { i18n } from '@/i18n'
import type { MergeSelectionState } from '@/features/book/lib/book-merge'
import type { LinkSelectionState } from '@/features/book/lib/book-link'

const permissionState = {
  allowed: new Set<string>(),
  demoRestricted: false,
}

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: (name: string) => permissionState.allowed.has(name),
    isDemoRestrictedAccount: {
      get value() {
        return permissionState.demoRestricted
      },
    },
  }),
}))

vi.mock('@/features/book/composables/useMetadataFieldSearch', () => ({
  usePublisherSearch: () => ({ search: vi.fn<(query: string) => Promise<string[]>>().mockResolvedValue([]) }),
  useSeriesNameSearch: () => ({ search: vi.fn<(query: string) => Promise<string[]>>().mockResolvedValue([]) }),
  useLanguageSearch: () => ({ search: vi.fn<(query: string) => Promise<string[]>>().mockResolvedValue([]) }),
}))

const globalStubs = {
  stubs: {
    DropdownMenu: { template: '<div><slot /></div>' },
    DropdownMenuTrigger: { template: '<div><slot /></div>' },
    DropdownMenuContent: { template: '<div><slot /></div>' },
    DropdownMenuItem: { template: '<button><slot /></button>' },
    DropdownMenuSeparator: { template: '<div />' },
    DropdownMenuSub: { template: '<div><slot /></div>' },
    DropdownMenuSubTrigger: { template: '<button><slot /></button>' },
    DropdownMenuSubContent: { template: '<div><slot /></div>' },
    Tooltip: { template: '<div><slot /></div>' },
    TooltipTrigger: { template: '<div><slot /></div>' },
    TooltipContent: { template: '<div><slot /></div>' },
    TooltipProvider: { template: '<div><slot /></div>' },
    BulkReadingStateDialog: {
      props: ['open'],
      emits: ['confirm'],
      template:
        '<button v-if="open" data-testid="bulk-reading-state-confirm-stub" @click="$emit(\'confirm\', { status: \'read\', finishedAt: null })">Confirm reading state</button>',
    },
  },
}

function mountBar() {
  return mount(SelectionActionBar, {
    props: {
      visible: true,
      count: 3,
      inCollection: false,
      inFlight: null,
    },
    global: globalStubs,
  })
}

describe('SelectionActionBar demo restriction', () => {
  it('hides metadata actions when the selection includes a read-only library', async () => {
    const wrapper = mountBar()
    await wrapper.setProps({ metadataEditable: false })
    expect(wrapper.find('[data-testid="action-edit-individually"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="action-bulk-set-field"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="action-bulk-set-rating"]').exists()).toBe(true)
  })

  beforeEach(() => {
    permissionState.allowed = new Set(['library_edit_metadata', 'library_download', 'email_send', 'library_delete_books'])
    permissionState.demoRestricted = false
  })

  it('shows bulk-edit controls for non-restricted accounts', async () => {
    const wrapper = mountBar()

    expect(wrapper.find('[data-testid="action-download-files"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="action-export-metadata"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="action-bulk-edit-metadata"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="action-edit-individually"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="action-bulk-set-status"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="action-bulk-set-rating"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="action-bulk-metadata-menu"]').exists()).toBe(true)

    expect(wrapper.find('[data-testid="action-bulk-refresh-metadata"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="action-bulk-re-extract-cover"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="action-bulk-lock-metadata"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="action-bulk-unlock-metadata"]').exists()).toBe(true)
  })

  it('hides edit-individually while the selection is query-scoped but keeps the bulk editor', () => {
    const wrapper = mount(SelectionActionBar, {
      props: { visible: true, count: 5000, inCollection: false, inFlight: null, queryScoped: true },
      global: globalStubs,
    })

    expect(wrapper.find('[data-testid="action-edit-individually"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="action-bulk-edit-metadata"]').exists()).toBe(true)
  })

  it('keeps metadata export available in the more menu with download-only permission', () => {
    permissionState.allowed = new Set(['library_download'])
    const wrapper = mountBar()

    expect(wrapper.find('[data-testid="action-download-files"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="action-bulk-metadata-menu"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="action-export-metadata"]').exists()).toBe(true)

    expect(wrapper.find('[data-testid="action-bulk-edit-metadata"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="action-bulk-refresh-metadata"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="action-bulk-re-extract-cover"]').exists()).toBe(false)
  })

  it('hides bulk-edit controls for demo-restricted accounts', () => {
    permissionState.demoRestricted = true
    const wrapper = mountBar()

    expect(wrapper.find('[data-testid="action-download-files"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="action-export-metadata"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="action-bulk-edit-metadata"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="action-bulk-set-status"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="action-bulk-set-rating"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="action-bulk-metadata-menu"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="action-add-to-collection"]').exists()).toBe(true)
  })

  it('emits add/send/download/metadata-export/reading-state/rating actions from default controls', async () => {
    const wrapper = mountBar()

    await wrapper.find('[data-testid="action-add-to-collection"]').trigger('click')
    expect(wrapper.emitted('add-to-collection')).toHaveLength(1)

    await wrapper.find('[data-testid="action-edit-individually"]').trigger('click')
    expect(wrapper.emitted('edit-individually')).toHaveLength(1)

    await wrapper.find('[data-testid="action-send-email"]').trigger('click')
    await wrapper.find('[data-testid="action-export-metadata"]').trigger('click')
    await wrapper.find('[data-testid="action-download-files"]').trigger('click')
    await wrapper
      .findAll('button')
      .find((btn) => btn.text() === 'Primary only')
      ?.trigger('click')
    expect(wrapper.emitted('send')).toHaveLength(1)
    expect(wrapper.emitted('export-metadata')).toHaveLength(1)
    expect(wrapper.emitted('download')?.[0]).toEqual(['primary'])

    await wrapper.find('[data-testid="action-bulk-set-status"]').trigger('click')
    await wrapper.find('[data-testid="bulk-reading-state-confirm-stub"]').trigger('click')
    expect(wrapper.emitted('set-status')?.[0]).toEqual([{ status: 'read', finishedAt: null }])

    await wrapper.find('[data-testid="action-bulk-set-rating"]').trigger('click')
    await nextTick()
    await wrapper
      .findAll('button')
      .find((btn) => btn.text() === '5')
      ?.trigger('click')
    expect(wrapper.emitted('set-rating')?.[0]).toEqual([5])
  })

  it('emits bulk metadata actions from Metadata menu', async () => {
    const wrapper = mountBar()

    await wrapper.find('[data-testid="action-bulk-re-extract-cover"]').trigger('click')
    await wrapper.find('[data-testid="action-bulk-lock-metadata"]').trigger('click')
    await wrapper.find('[data-testid="action-bulk-unlock-metadata"]').trigger('click')

    expect(wrapper.emitted('re-extract-cover')).toHaveLength(1)
    expect(wrapper.emitted('lock-metadata')?.map((args) => args[0])).toEqual([true, false])
  })

  it('confirms a bulk metadata refresh and keeps the cache unless asked to ignore it', async () => {
    const wrapper = mountBar()

    await wrapper.find('[data-testid="action-bulk-refresh-metadata"]').trigger('click')
    expect(wrapper.emitted('refresh-metadata')).toBeUndefined()
    expect(wrapper.find('[data-testid="bulk-refresh-confirm"]').exists()).toBe(true)
    const checkbox = wrapper.get<HTMLInputElement>('[data-testid="ignore-cache-checkbox"]')
    expect(checkbox.element.checked).toBe(false)

    await wrapper.get('[data-testid="bulk-refresh-confirm-action"]').trigger('click')
    expect(wrapper.emitted('refresh-metadata')?.[0]).toEqual([{ ignoreCache: false }])
    expect(wrapper.find('[data-testid="bulk-refresh-confirm"]').exists()).toBe(false)

    await wrapper.find('[data-testid="action-bulk-refresh-metadata"]').trigger('click')
    await wrapper.get('[data-testid="ignore-cache-checkbox"]').setValue(true)
    await wrapper.get('[data-testid="bulk-refresh-confirm-action"]').trigger('click')
    expect(wrapper.emitted('refresh-metadata')?.[1]).toEqual([{ ignoreCache: true }])
  })

  it('resets the ignore-cache choice and emits nothing when a bulk refresh is cancelled', async () => {
    const wrapper = mountBar()

    await wrapper.find('[data-testid="action-bulk-refresh-metadata"]').trigger('click')
    await wrapper.get('[data-testid="ignore-cache-checkbox"]').setValue(true)
    await wrapper.get('[data-testid="bulk-refresh-cancel"]').trigger('click')

    expect(wrapper.emitted('refresh-metadata')).toBeUndefined()
    expect(wrapper.find('[data-testid="action-bulk-metadata-menu"]').exists()).toBe(true)

    await wrapper.find('[data-testid="action-bulk-refresh-metadata"]').trigger('click')
    expect(wrapper.get<HTMLInputElement>('[data-testid="ignore-cache-checkbox"]').element.checked).toBe(false)
  })

  it('emits set-field from the field editor flow', async () => {
    const wrapper = mountBar()
    await wrapper.find('[data-testid="action-bulk-set-field"]').trigger('click')
    await nextTick()

    const select = wrapper.find('select')
    const input = wrapper.find('input')
    await select.setValue('language')
    await input.setValue('fr')
    await wrapper
      .findAll('button')
      .find((btn) => btn.text() === 'Apply')
      ?.trigger('click')

    expect(wrapper.emitted('set-field')?.[0]).toEqual(['language', 'fr'])
  })

  it('clears numeric fields when the field editor input is blank', async () => {
    const wrapper = mountBar()
    await wrapper.find('[data-testid="action-bulk-set-field"]').trigger('click')
    await nextTick()

    const select = wrapper.find('select')
    await select.setValue('publishedYear')
    await nextTick()
    await wrapper
      .findAll('button')
      .find((btn) => btn.text() === 'Apply')
      ?.trigger('click')

    expect(wrapper.emitted('set-field')?.[0]).toEqual(['publishedYear', null])
  })

  it('emits list fields as deduplicated comma-separated values', async () => {
    const wrapper = mountBar()
    await wrapper.find('[data-testid="action-bulk-set-field"]').trigger('click')
    await nextTick()

    const select = wrapper.find('select')
    await select.setValue('authors')
    await nextTick()
    await wrapper.find('input').setValue(' Author A, Author B , Author A ')
    await wrapper
      .findAll('button')
      .find((btn) => btn.text() === 'Apply')
      ?.trigger('click')

    expect(wrapper.emitted('set-field')?.[0]).toEqual(['authors', ['Author A', 'Author B']])
  })

  it('requires DELETE confirmation text when count exceeds 50', async () => {
    const wrapper = mount(SelectionActionBar, {
      props: { visible: true, count: 75, inCollection: false, inFlight: null },
      global: globalStubs,
    })

    await wrapper.find('[data-testid="action-delete"]').trigger('click')
    await nextTick()

    const confirmButton = wrapper.findAll('button').find((btn) => btn.text() === 'Delete')
    expect(confirmButton?.attributes('disabled')).toBeDefined()

    const input = wrapper.find('input[placeholder="Type DELETE"]')
    await input.setValue('DELETE')
    await nextTick()
    expect(
      wrapper
        .findAll('button')
        .find((btn) => btn.text() === 'Delete')
        ?.attributes('disabled'),
    ).toBeUndefined()
  })

  it('resets transient menu state when visibility is turned off', async () => {
    const wrapper = mountBar()
    await wrapper.find('[data-testid="action-bulk-set-field"]').trigger('click')
    await nextTick()
    expect(wrapper.find('select').exists()).toBe(true)

    await wrapper.setProps({ visible: false })
    await nextTick()
    await wrapper.setProps({ visible: true })
    await nextTick()

    expect(wrapper.find('[data-testid="action-bulk-metadata-menu"]').exists()).toBe(true)
    expect(wrapper.find('select').exists()).toBe(false)
  })
})

describe('SelectionActionBar merge action', () => {
  const mergeStubs = {
    stubs: {
      ...globalStubs.stubs,
      DropdownMenuItem: { emits: ['select'], template: '<button type="button" @click="$emit(\'select\', $event)"><slot /></button>' },
    },
  }

  function mountWithMerge(merge: MergeSelectionState | null, count = 2) {
    return mount(SelectionActionBar, {
      props: { visible: true, count, inCollection: false, inFlight: null, merge },
      global: mergeStubs,
    })
  }

  beforeEach(() => {
    permissionState.allowed = new Set(['library_edit_metadata', 'library_merge_books'])
    permissionState.demoRestricted = false
  })

  it('leaves Merge out when the selection offers no merge state', () => {
    expect(mountWithMerge(null).find('[data-testid="action-merge-books"]').exists()).toBe(false)
  })

  it('leaves Merge out for demo-restricted accounts', () => {
    permissionState.demoRestricted = true
    expect(mountWithMerge({ disabledReason: null }).find('[data-testid="action-merge-books"]').exists()).toBe(false)
  })

  it('emits merge when the selection can be merged', async () => {
    const wrapper = mountWithMerge({ disabledReason: null })
    const item = wrapper.get('[data-testid="action-merge-books"]')
    expect(item.attributes('aria-disabled')).toBeUndefined()
    expect(wrapper.find('[data-testid="action-merge-books-reason"]').exists()).toBe(false)

    await item.trigger('click')
    expect(wrapper.emitted('merge')).toHaveLength(1)
  })

  it.each([
    { reason: 'queryScoped', text: () => i18n.global.t('book.merge.disabled.queryScoped') },
    { reason: 'tooFew', text: () => i18n.global.t('book.merge.disabled.tooFew') },
    { reason: 'tooMany', text: () => i18n.global.t('book.merge.disabled.tooMany', { max: BOOK_MERGE_MAX_BOOKS }) },
    { reason: 'notEditable', text: () => i18n.global.t('book.merge.disabled.notEditable') },
  ] as const)('shows the $reason reason and does not emit', async ({ reason, text }) => {
    const wrapper = mountWithMerge({ disabledReason: reason })
    const item = wrapper.get('[data-testid="action-merge-books"]')
    expect(item.attributes('aria-disabled')).toBe('true')
    expect(wrapper.get('[data-testid="action-merge-books-reason"]').text()).toBe(text())

    await item.trigger('click')
    expect(wrapper.emitted('merge')).toBeUndefined()
  })
})

describe('SelectionActionBar link action', () => {
  const linkStubs = {
    stubs: {
      ...globalStubs.stubs,
      DropdownMenuItem: { emits: ['select'], template: '<button type="button" @click="$emit(\'select\', $event)"><slot /></button>' },
    },
  }

  function mountWithLink(link: LinkSelectionState | null, extra: Record<string, unknown> = {}) {
    return mount(SelectionActionBar, {
      props: { visible: true, count: 2, inCollection: false, inFlight: null, link, ...extra },
      global: linkStubs,
    })
  }

  beforeEach(() => {
    i18n.global.locale.value = 'en'
    permissionState.allowed = new Set(['library_merge_books', 'library_delete_books'])
    permissionState.demoRestricted = false
  })

  it('leaves Link out when the selection offers no link state', () => {
    expect(mountWithLink(null).find('[data-testid="action-link-books"]').exists()).toBe(false)
  })

  it('leaves Link out for demo-restricted accounts', () => {
    permissionState.demoRestricted = true
    expect(mountWithLink({ disabledReason: null }).find('[data-testid="action-link-books"]').exists()).toBe(false)
  })

  it('emits link when the selection can be linked', async () => {
    const wrapper = mountWithLink({ disabledReason: null })
    const item = wrapper.get('[data-testid="action-link-books"]')
    expect(item.attributes('aria-disabled')).toBeUndefined()
    expect(item.text()).toContain('Link...')

    await item.trigger('click')
    expect(wrapper.emitted('link')).toHaveLength(1)
  })

  it.each([
    { reason: 'queryScoped', text: 'Select the books one by one to link them' },
    { reason: 'tooFew', text: 'Select at least two books to link' },
    { reason: 'tooMany', text: `Link up to ${BOOK_LINK_MAX_MEMBERS} books at a time` },
    { reason: 'notEditable', text: 'Only books in libraries you can edit can be linked' },
  ] as const)('shows the $reason reason and does not emit', async ({ reason, text }) => {
    const wrapper = mountWithLink({ disabledReason: reason })
    const item = wrapper.get('[data-testid="action-link-books"]')
    expect(item.attributes('aria-disabled')).toBe('true')
    expect(wrapper.get('[data-testid="action-link-books-reason"]').text()).toBe(text)

    await item.trigger('click')
    expect(wrapper.emitted('link')).toBeUndefined()
  })

  it('offers Merge for books in different libraries alongside Link', () => {
    const wrapper = mountWithLink({ disabledReason: null }, { merge: { disabledReason: null } })
    expect(wrapper.get('[data-testid="action-merge-books"]').attributes('aria-disabled')).toBeUndefined()
    expect(wrapper.find('[data-testid="action-merge-books-reason"]').exists()).toBe(false)
  })

  it('says why Merge is off when a selected book sits in a library the user cannot edit', () => {
    const wrapper = mountWithLink(null, { merge: { disabledReason: 'notEditable' } })
    expect(wrapper.get('[data-testid="action-merge-books-reason"]').text()).toBe('Only books in libraries you can edit can be merged')
  })

  it('says linked books are not affected when deleting a selection that holds them', async () => {
    const wrapper = mountWithLink(null, { linkedSelected: true })
    await wrapper.get('[data-testid="action-delete"]').trigger('click')
    expect(wrapper.get('[data-testid="delete-linked-note"]').text()).toBe('Books linked with the selection are not affected.')
  })

  it('leaves the delete confirmation alone for a selection without linked books', async () => {
    const wrapper = mountWithLink(null)
    await wrapper.get('[data-testid="action-delete"]').trigger('click')
    expect(wrapper.text()).toContain('Delete 2 books?')
    expect(wrapper.find('[data-testid="delete-linked-note"]').exists()).toBe(false)
  })
})
