import { mount } from '@vue/test-utils'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { nextTick } from 'vue'
import SelectionActionBar from '../SelectionActionBar.vue'

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
    Tooltip: { template: '<div><slot /></div>' },
    TooltipTrigger: { template: '<div><slot /></div>' },
    TooltipContent: { template: '<div><slot /></div>' },
    TooltipProvider: { template: '<div><slot /></div>' },
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
  beforeEach(() => {
    permissionState.allowed = new Set(['library_edit_metadata', 'library_download', 'email_send', 'library_delete_books'])
    permissionState.demoRestricted = false
  })

  it('shows bulk-edit controls for non-restricted accounts', async () => {
    const wrapper = mountBar()

    expect(wrapper.find('[data-testid="action-download-files"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="action-export-metadata"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="action-bulk-edit-metadata"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="action-bulk-set-status"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="action-bulk-set-rating"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="action-bulk-metadata-menu"]').exists()).toBe(true)

    expect(wrapper.find('[data-testid="action-bulk-refresh-metadata"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="action-bulk-re-extract-cover"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="action-bulk-lock-metadata"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="action-bulk-unlock-metadata"]').exists()).toBe(true)
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

  it('emits add/send/download/metadata-export/status/rating/tag actions from default controls', async () => {
    const wrapper = mountBar()

    await wrapper.find('[data-testid="action-add-to-collection"]').trigger('click')
    expect(wrapper.emitted('add-to-collection')).toHaveLength(1)

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
    await wrapper
      .findAll('button')
      .find((btn) => btn.text().includes('Reading'))
      ?.trigger('click')
    expect(wrapper.emitted('set-status')?.[0]).toEqual(['reading'])

    await wrapper.find('[data-testid="action-bulk-set-rating"]').trigger('click')
    await nextTick()
    await wrapper
      .findAll('button')
      .find((btn) => btn.text() === '5')
      ?.trigger('click')
    expect(wrapper.emitted('set-rating')?.[0]).toEqual([5])

    await wrapper.find('[data-testid="action-bulk-edit-tags"]').trigger('click')
    expect(wrapper.emitted('edit-tags')).toHaveLength(1)
  })

  it('emits bulk metadata actions from Metadata menu', async () => {
    const wrapper = mountBar()

    await wrapper.find('[data-testid="action-bulk-refresh-metadata"]').trigger('click')
    await wrapper.find('[data-testid="action-bulk-re-extract-cover"]').trigger('click')
    await wrapper.find('[data-testid="action-bulk-lock-metadata"]').trigger('click')
    await wrapper.find('[data-testid="action-bulk-unlock-metadata"]').trigger('click')

    expect(wrapper.emitted('refresh-metadata')).toHaveLength(1)
    expect(wrapper.emitted('re-extract-cover')).toHaveLength(1)
    expect(wrapper.emitted('lock-metadata')?.map((args) => args[0])).toEqual([true, false])
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
