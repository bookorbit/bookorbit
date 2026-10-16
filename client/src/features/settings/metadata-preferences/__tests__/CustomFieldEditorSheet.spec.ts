import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { CustomMetadataFieldDefinition, Library } from '@bookorbit/types'
import CustomFieldEditorSheet from '../components/CustomFieldEditorSheet.vue'

vi.mock('@/lib/api', () => ({
  api: vi.fn<() => Promise<{ ok: boolean; json: () => Promise<unknown[]> }>>(async () => ({ ok: true, json: async () => [] })),
}))

// The real sheet portals into a reka dialog; the stub renders its slots in place and lets a test fire its events.
const SheetStub = defineComponent({
  name: 'SettingsEditorSheet',
  props: ['open', 'title', 'description', 'dirty', 'busy', 'menuActions'],
  emits: ['save', 'cancel', 'action'],
  setup(_, { slots }) {
    return () => h('div', [slots.status?.(), slots.default?.(), slots.footer?.({ requestClose: () => {} })])
  },
})

const libraries = [
  { id: 2, name: 'Audiobooks', icon: 'AudioLines', bookCount: 4, fileWriteEnabled: true, fileWriteEpubEnabled: false, fileWriteFb2Enabled: false },
  { id: 6, name: 'Comics', icon: null, bookCount: 10, fileWriteEnabled: false, fileWriteEpubEnabled: true, fileWriteFb2Enabled: false },
  { id: 1, name: 'Novels', icon: null, bookCount: 454, fileWriteEnabled: true, fileWriteEpubEnabled: true, fileWriteFb2Enabled: true },
] as unknown as Library[]

function field(overrides: Partial<CustomMetadataFieldDefinition> = {}): CustomMetadataFieldDefinition {
  return {
    id: 3,
    key: 'shelf_number',
    label: 'Shelf Number',
    type: 'number',
    displayOrder: 0,
    archivedAt: null,
    createdAt: '2026-10-08T00:00:00.000Z',
    updatedAt: '2026-10-08T00:00:00.000Z',
    enabledLibraryIds: [1, 6],
    usageCount: 217,
    usageByLibrary: { 1: 207, 6: 10 },
    ...overrides,
  }
}

function mountSheet(props: Partial<InstanceType<typeof CustomFieldEditorSheet>['$props']>) {
  return mount(CustomFieldEditorSheet, {
    props: { open: true, mode: 'edit', field: null, fields: [], libraries, ...props },
    global: { stubs: { SettingsEditorSheet: SheetStub } },
  })
}

describe('CustomFieldEditorSheet', () => {
  it('starts a new field on every library and shows the key it will be saved under', async () => {
    const wrapper = mountSheet({ mode: 'create', fields: [field()] })
    const boxes = wrapper.findAll('input[type="checkbox"]')
    expect(boxes).toHaveLength(3)
    expect(boxes.every((box) => (box.element as HTMLInputElement).checked)).toBe(true)

    await wrapper.find('input.input-field').setValue('Original Title')
    expect(wrapper.text()).toContain('original_title')
    expect(wrapper.text()).toContain('On all 3 libraries')
  })

  it('creates with the chosen type and libraries', async () => {
    const wrapper = mountSheet({ mode: 'create' })
    await wrapper.find('input.input-field').setValue('  Acquired On ')
    await wrapper.find('input[type="radio"][value="date"]').trigger('change')
    await wrapper.findAll('input[type="checkbox"]')[0]!.setValue(false)

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Create field')!
      .trigger('click')

    expect(wrapper.emitted('create')).toEqual([[{ label: 'Acquired On', type: 'date', enabledLibraryIds: [6, 1] }]])
  })

  it('refuses a label another active field already uses', async () => {
    const wrapper = mountSheet({ mode: 'create', fields: [field()] })
    await wrapper.find('input.input-field').setValue('shelf number')

    expect(wrapper.text()).toContain('A field with this label already exists')
    const create = wrapper.findAll('button').find((button) => button.text() === 'Create field')!
    expect(create.attributes('disabled')).toBeDefined()
  })

  it('warns that switching a library off hides the values stored there', async () => {
    const wrapper = mountSheet({ field: field() })
    const comics = wrapper.findAll('input[type="checkbox"]')[1]!
    await comics.setValue(false)

    expect(wrapper.text()).toContain('10 values in Comics stay stored but hidden while the field is off there.')
    expect(wrapper.text()).toContain('10 hidden')
  })

  it('saves the edited label and libraries, and closes without a request when nothing changed', async () => {
    const wrapper = mountSheet({ field: field() })
    const sheet = wrapper.findComponent({ name: 'SettingsEditorSheet' })

    sheet.vm.$emit('save')
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(wrapper.emitted('save')).toBeUndefined()

    await wrapper.find('input.input-field').setValue('Shelf')
    await wrapper.findAll('input[type="checkbox"]')[0]!.setValue(true)
    sheet.vm.$emit('save')

    expect(wrapper.emitted('save')?.[0]?.[1]).toEqual({ label: 'Shelf', enabledLibraryIds: [1, 6, 2] })
  })

  it('names the libraries that write the field into files', () => {
    const wrapper = mountSheet({ field: field() })

    expect(wrapper.text()).toContain('bookorbit:custom:shelf_number')
    expect(wrapper.text()).toContain('Written into EPUB and FB2 files in Novels')
  })

  it('offers archive behind a confirm in the sheet menu', async () => {
    const wrapper = mountSheet({ field: field(), canMoveUp: false, canMoveDown: true })
    const sheet = wrapper.findComponent({ name: 'SettingsEditorSheet' })
    const actions = sheet.props('menuActions') as Array<{ id: string; confirm?: string; disabled?: boolean }>

    expect(actions.map((action) => action.id)).toEqual(['move-up', 'move-down', 'archive'])
    expect(actions[0]!.disabled).toBe(true)
    expect(actions[2]!.confirm).toBe('Archive Shelf Number?')

    sheet.vm.$emit('action', 'archive')
    await nextTick()
    expect(wrapper.emitted('archive')).toHaveLength(1)
  })

  it('asks for the field name before deleting an archived field that holds values', async () => {
    const wrapper = mountSheet({ mode: 'archived', field: field({ archivedAt: '2026-10-01T00:00:00.000Z' }), confirmDelete: true })
    const remove = () => wrapper.findAll('button').find((button) => button.text().includes('Delete forever'))!

    expect(remove().attributes('disabled')).toBeDefined()
    await wrapper.find('input[placeholder="Type Shelf Number to confirm"]').setValue('Shelf Number')
    expect(remove().attributes('disabled')).toBeUndefined()

    await remove().trigger('click')
    expect(wrapper.emitted('delete')).toHaveLength(1)
  })
})
