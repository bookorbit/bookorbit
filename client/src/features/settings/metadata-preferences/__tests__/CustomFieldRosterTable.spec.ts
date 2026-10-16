import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { CustomMetadataFieldDefinition, Library } from '@bookorbit/types'
import CustomFieldRosterTable from '../components/CustomFieldRosterTable.vue'

vi.mock('@/lib/api', () => ({
  api: vi.fn<() => Promise<{ ok: boolean; json: () => Promise<unknown[]> }>>(async () => ({ ok: true, json: async () => [] })),
}))

const libraries = [
  { id: 6, name: 'Comics', icon: null, bookCount: 10 },
  { id: 1, name: 'Novels', icon: null, bookCount: 454 },
] as unknown as Library[]

function field(overrides: Partial<CustomMetadataFieldDefinition>): CustomMetadataFieldDefinition {
  return {
    id: 1,
    key: 'edition_note',
    label: 'Edition Note',
    type: 'text',
    displayOrder: 0,
    archivedAt: null,
    createdAt: '2026-10-08T00:00:00.000Z',
    updatedAt: '2026-10-08T00:00:00.000Z',
    enabledLibraryIds: [1],
    usageCount: 38,
    usageByLibrary: { 1: 38 },
    ...overrides,
  }
}

function mountTable(fields: CustomMetadataFieldDefinition[], view: 'active' | 'archived' = 'active') {
  return mount(CustomFieldRosterTable, { props: { fields, view, libraries, canReorder: true, restoringId: null } })
}

describe('CustomFieldRosterTable', () => {
  it('shows each field on one row with its type, libraries and coverage', () => {
    const wrapper = mountTable([field({}), field({ id: 2, label: 'Loaned To', enabledLibraryIds: [6, 1], usageCount: 3, usageByLibrary: { 1: 3 } })])
    const rows = wrapper.findAll('tbody tr')

    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('Edition Note')
    expect(rows[0]!.text()).toContain('Text')
    expect(rows[0]!.text()).toContain('Novels')
    expect(rows[0]!.find('[aria-label="38 of 454 books have a value"]').exists()).toBe(true)
    expect(rows[1]!.text()).toContain('All libraries')
  })

  it('flags a field on no library', () => {
    const wrapper = mountTable([field({ enabledLibraryIds: [], usageCount: 0, usageByLibrary: {} })])

    expect(wrapper.text()).toContain('No libraries')
    expect(wrapper.find('tbody tr').classes().join(' ')).toContain('--pill-warning')
  })

  it('opens a field when its row is clicked, but not from the drag handle', async () => {
    const wrapper = mountTable([field({})])

    await wrapper.find('.custom-field-handle').trigger('click')
    expect(wrapper.emitted('open')).toBeUndefined()

    await wrapper.find('tbody tr').trigger('click')
    expect(wrapper.emitted('open')).toHaveLength(1)
  })

  it('lists archived fields with the values they keep and a visible Restore', async () => {
    const wrapper = mountTable([field({ archivedAt: '2026-09-24T00:00:00.000Z', usageCount: 212 })], 'archived')

    expect(wrapper.text()).toContain('212')
    const restore = wrapper.findAll('button').find((button) => button.text() === 'Restore')!
    await restore.trigger('click')

    expect(wrapper.emitted('restore')).toHaveLength(1)
    expect(wrapper.emitted('open')).toBeUndefined()
  })
})
