import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SmartScope } from '@bookorbit/types'
import SmartScopeEditorPanel from '../SmartScopeEditorPanel.vue'

const mockState = vi.hoisted(() => ({
  updateSmartScope: vi.fn<(id: number, payload: Record<string, unknown>) => Promise<unknown>>(),
  api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
}))

vi.mock('@/features/smart-scope/composables/useSmartScopes', () => ({
  useSmartScopes: () => ({ updateSmartScope: mockState.updateSmartScope }),
}))

vi.mock('@/lib/api', () => ({
  api: mockState.api,
}))

const SHARING_SWITCH = 'button[aria-label="Visible to all users"]'
const KOBO_SWITCH = 'button[aria-label="Sync to Kobo"]'

function makeSmartScope(overrides: Partial<SmartScope> = {}): SmartScope {
  return {
    id: 11,
    userId: 3,
    name: 'Unread Sci-Fi',
    icon: 'Aperture',
    filter: null,
    defaultSort: [],
    isPublic: false,
    syncToKobo: false,
    koboSyncEnabled: false,
    isOwner: true,
    displayOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function mountPanel(smartScope: SmartScope) {
  return mount(SmartScopeEditorPanel, {
    props: { open: false, smartScope },
    global: {
      stubs: {
        Teleport: true,
        BookFilterBuilder: true,
        BookSortBuilder: true,
        IconPicker: true,
      },
    },
  })
}

type Panel = ReturnType<typeof mountPanel>

async function openPanel(smartScope: SmartScope): Promise<Panel> {
  const wrapper = mountPanel(smartScope)
  await wrapper.setProps({ open: true })
  return wrapper
}

async function save(wrapper: Panel): Promise<void> {
  const saveButton = wrapper.findAll('button').find((button) => button.text().trim() === 'Save changes')
  await saveButton!.trigger('click')
  await flushPromises()
}

function savedPayload(): Record<string, unknown> {
  return mockState.updateSmartScope.mock.calls[0]![1]
}

describe('SmartScopeEditorPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState.updateSmartScope.mockResolvedValue(makeSmartScope())
    mockState.api.mockResolvedValue({ ok: true, json: async () => ({ total: 0 }) } as Response)
  })

  it('seeds the sharing toggle from the scope when the panel opens', async () => {
    const wrapper = await openPanel(makeSmartScope({ isPublic: true, syncToKobo: false }))

    expect(wrapper.find(SHARING_SWITCH).attributes('aria-checked')).toBe('true')
    expect(wrapper.find(KOBO_SWITCH).attributes('aria-checked')).toBe('false')
  })

  it('shows a private scope as not shared', async () => {
    const wrapper = await openPanel(makeSmartScope({ isPublic: false, syncToKobo: true }))

    expect(wrapper.find(SHARING_SWITCH).attributes('aria-checked')).toBe('false')
    expect(wrapper.find(KOBO_SWITCH).attributes('aria-checked')).toBe('true')
  })

  it('shares an existing scope instead of requiring it to be recreated', async () => {
    const wrapper = await openPanel(makeSmartScope({ isPublic: false }))

    await wrapper.find(SHARING_SWITCH).trigger('click')
    await save(wrapper)

    expect(mockState.updateSmartScope).toHaveBeenCalledTimes(1)
    expect(mockState.updateSmartScope).toHaveBeenCalledWith(11, {
      name: 'Unread Sci-Fi',
      icon: 'Aperture',
      filter: undefined,
      defaultSort: [],
      isPublic: true,
      syncToKobo: false,
    })
    expect(wrapper.emitted('saved')).toEqual([[]])
    expect(wrapper.emitted('close')).toEqual([[]])
  })

  it('unshares a scope that was previously visible to all users', async () => {
    const wrapper = await openPanel(makeSmartScope({ isPublic: true }))

    await wrapper.find(SHARING_SWITCH).trigger('click')
    await save(wrapper)

    expect(savedPayload()).toMatchObject({ isPublic: false })
  })

  it('keeps a shared scope shared when only unrelated fields are edited', async () => {
    const wrapper = await openPanel(makeSmartScope({ isPublic: true, syncToKobo: true }))

    await wrapper.find('input[type="text"]').setValue('Shared Sci-Fi')
    await save(wrapper)

    expect(savedPayload()).toMatchObject({ name: 'Shared Sci-Fi', isPublic: true, syncToKobo: true })
  })

  it('keeps sharing and Kobo sync independent of each other', async () => {
    const wrapper = await openPanel(makeSmartScope({ isPublic: false, syncToKobo: false }))

    await wrapper.find(KOBO_SWITCH).trigger('click')

    expect(wrapper.find(SHARING_SWITCH).attributes('aria-checked')).toBe('false')

    await save(wrapper)

    expect(savedPayload()).toMatchObject({ isPublic: false, syncToKobo: true })
  })

  it('trims the name and keeps the sharing choice when saving', async () => {
    const wrapper = await openPanel(makeSmartScope({ isPublic: false }))

    await wrapper.find('input[type="text"]').setValue('  Padded Name  ')
    await wrapper.find(SHARING_SWITCH).trigger('click')
    await save(wrapper)

    expect(savedPayload()).toMatchObject({ name: 'Padded Name', isPublic: true })
  })

  it('discards an unsaved sharing change when the panel is reopened', async () => {
    const wrapper = await openPanel(makeSmartScope({ isPublic: false }))

    await wrapper.find(SHARING_SWITCH).trigger('click')
    expect(wrapper.find(SHARING_SWITCH).attributes('aria-checked')).toBe('true')

    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })

    expect(wrapper.find(SHARING_SWITCH).attributes('aria-checked')).toBe('false')
  })

  it('reseeds the sharing toggle when the panel reopens for a different scope', async () => {
    const wrapper = await openPanel(makeSmartScope({ id: 11, isPublic: true }))

    expect(wrapper.find(SHARING_SWITCH).attributes('aria-checked')).toBe('true')

    await wrapper.setProps({ open: false })
    await wrapper.setProps({ smartScope: makeSmartScope({ id: 12, name: 'Private Scope', isPublic: false }), open: true })

    expect(wrapper.find(SHARING_SWITCH).attributes('aria-checked')).toBe('false')

    await save(wrapper)

    expect(mockState.updateSmartScope).toHaveBeenCalledWith(12, expect.objectContaining({ isPublic: false }))
  })

  it('blocks the save when the name is emptied so the sharing change is never sent', async () => {
    const wrapper = await openPanel(makeSmartScope({ isPublic: false }))

    await wrapper.find(SHARING_SWITCH).trigger('click')
    await wrapper.find('input[type="text"]').setValue('   ')

    const saveButton = wrapper.findAll('button').find((button) => button.text().trim() === 'Save changes')
    expect(saveButton!.attributes('disabled')).toBeDefined()

    await save(wrapper)

    expect(mockState.updateSmartScope).not.toHaveBeenCalled()
    expect(wrapper.emitted('saved')).toBeUndefined()
  })

  it('keeps the panel open and reports the failure when saving the sharing change fails', async () => {
    mockState.updateSmartScope.mockRejectedValueOnce(new Error('HTTP 500'))
    const wrapper = await openPanel(makeSmartScope({ isPublic: false }))

    await wrapper.find(SHARING_SWITCH).trigger('click')
    await save(wrapper)

    expect(savedPayload()).toMatchObject({ isPublic: true })
    expect(wrapper.text()).toContain('Failed to save')
    expect(wrapper.emitted('saved')).toBeUndefined()
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(wrapper.find(SHARING_SWITCH).attributes('aria-checked')).toBe('true')
  })
})
