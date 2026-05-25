import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SendBookDialog from '../SendBookDialog.vue'

const mockState = vi.hoisted(() => ({
  providers: [] as Array<{ id: number; name: string }>,
  recipients: [] as Array<{ id: number; name: string; email: string; isDefault: boolean }>,
  groups: [] as Array<{ id: number; name: string; members: Array<{ id: number }> }>,
  templates: [] as Array<{ id: number; name: string }>,
  fetchProviders: vi.fn<() => Promise<void>>(),
  fetchRecipients: vi.fn<() => Promise<void>>(),
  fetchGroups: vi.fn<() => Promise<void>>(),
  fetchTemplates: vi.fn<() => Promise<void>>(),
  sendBook: vi.fn<(payload: unknown) => Promise<{ queued: number }>>(),
  toastSuccess: vi.fn<(message: string) => void>(),
  toastError: vi.fn<(message: string) => void>(),
}))

vi.mock('../../composables/useEmailProviders', () => ({
  useEmailProviders: () => ({
    providers: mockState.providers,
    fetchProviders: mockState.fetchProviders,
  }),
}))

vi.mock('../../composables/useEmailRecipients', () => ({
  useEmailRecipients: () => ({
    recipients: mockState.recipients,
    fetchRecipients: mockState.fetchRecipients,
  }),
}))

vi.mock('../../composables/useEmailGroups', () => ({
  useEmailGroups: () => ({
    groups: mockState.groups,
    fetchGroups: mockState.fetchGroups,
  }),
}))

vi.mock('../../composables/useEmailTemplates', () => ({
  useEmailTemplates: () => ({
    templates: mockState.templates,
    fetchTemplates: mockState.fetchTemplates,
  }),
}))

vi.mock('../../composables/useEmailSend', () => ({
  useEmailSend: () => ({
    sendBook: mockState.sendBook,
  }),
}))

vi.mock('vue-sonner', () => ({
  toast: {
    success: mockState.toastSuccess,
    error: mockState.toastError,
  },
}))

function mountDialog(
  overrides: Partial<{ open: boolean; bookIds: number[]; bookFiles: Array<{ id: number; format: string | null; role: string }> }> = {},
) {
  return mount(SendBookDialog, {
    props: {
      open: true,
      bookIds: [12],
      ...overrides,
    },
    global: {
      stubs: {
        Teleport: true,
      },
    },
  })
}

describe('SendBookDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockState.providers.splice(0, mockState.providers.length, { id: 3, name: 'SMTP Default' })
    mockState.recipients.splice(0, mockState.recipients.length, { id: 10, name: 'Kindle', email: 'reader@example.com', isDefault: true })
    mockState.groups.splice(0, mockState.groups.length, { id: 99, name: 'Devices', members: [{ id: 10 }] })
    mockState.templates.splice(0, mockState.templates.length, { id: 7, name: 'Default Template' })

    mockState.fetchProviders.mockResolvedValue(undefined)
    mockState.fetchRecipients.mockResolvedValue(undefined)
    mockState.fetchGroups.mockResolvedValue(undefined)
    mockState.fetchTemplates.mockResolvedValue(undefined)
    mockState.sendBook.mockResolvedValue({ queued: 2 })
  })

  it('fetches dialog data immediately when mounted with open=true', () => {
    mountDialog({ open: true })

    expect(mockState.fetchRecipients).toHaveBeenCalledTimes(1)
    expect(mockState.fetchGroups).toHaveBeenCalledTimes(1)
    expect(mockState.fetchProviders).toHaveBeenCalledTimes(1)
    expect(mockState.fetchTemplates).toHaveBeenCalledTimes(1)
  })

  it('does not fetch while closed, then fetches once when opened', async () => {
    const wrapper = mountDialog({ open: false })

    expect(mockState.fetchRecipients).not.toHaveBeenCalled()
    expect(mockState.fetchGroups).not.toHaveBeenCalled()
    expect(mockState.fetchProviders).not.toHaveBeenCalled()
    expect(mockState.fetchTemplates).not.toHaveBeenCalled()

    await wrapper.setProps({ open: true })

    expect(mockState.fetchRecipients).toHaveBeenCalledTimes(1)
    expect(mockState.fetchGroups).toHaveBeenCalledTimes(1)
    expect(mockState.fetchProviders).toHaveBeenCalledTimes(1)
    expect(mockState.fetchTemplates).toHaveBeenCalledTimes(1)
  })

  it('sends selected recipients and groups, then emits close and sent', async () => {
    const wrapper = mountDialog({
      open: true,
      bookIds: [12, 13],
      bookFiles: [
        { id: 101, format: 'epub', role: 'primary' },
        { id: 102, format: 'pdf', role: 'secondary' },
      ],
    })

    const checkboxes = wrapper.findAll('input[type="checkbox"]')
    expect(checkboxes).toHaveLength(2)

    await checkboxes[0]!.trigger('change')
    await checkboxes[1]!.trigger('change')

    await wrapper.findAll('select')[0]!.setValue('102')
    await wrapper.findAll('select')[1]!.setValue('3')
    await wrapper.findAll('select')[2]!.setValue('7')

    const sendButton = wrapper.findAll('button').find((button) => button.text().trim() === 'Send')
    await sendButton!.trigger('click')

    expect(mockState.sendBook).toHaveBeenCalledWith({
      bookIds: [12, 13],
      recipientIds: [10],
      groupIds: [99],
      providerId: 3,
      templateId: 7,
      fileId: 102,
    })
    expect(mockState.toastSuccess).toHaveBeenCalledWith('2 emails queued')
    expect(wrapper.emitted('update:open')).toEqual([[false]])
    expect(wrapper.emitted('sent')).toEqual([[]])
  })

  it('can deselect recipient and group after selecting them', async () => {
    const wrapper = mountDialog({ open: true })

    const checkboxes = wrapper.findAll('input[type="checkbox"]')
    await checkboxes[0]!.trigger('change')
    await checkboxes[1]!.trigger('change')
    await checkboxes[0]!.trigger('change')
    await checkboxes[1]!.trigger('change')
    await checkboxes[0]!.trigger('change')

    const sendButton = wrapper.findAll('button').find((button) => button.text().trim() === 'Send')
    await sendButton!.trigger('click')

    expect(mockState.sendBook).toHaveBeenCalledWith({
      bookIds: [12],
      recipientIds: [10],
      groupIds: undefined,
      providerId: undefined,
      templateId: undefined,
      fileId: undefined,
    })
  })

  it('shows a toast error when send fails', async () => {
    mockState.sendBook.mockRejectedValueOnce(new Error('Failed to send'))

    const wrapper = mountDialog()

    const recipientCheckbox = wrapper.find('input[type="checkbox"]')
    await recipientCheckbox.trigger('change')

    const sendButton = wrapper.findAll('button').find((button) => button.text().trim() === 'Send')
    await sendButton!.trigger('click')

    expect(mockState.toastError).toHaveBeenCalledWith('Failed to send')
    expect(wrapper.emitted('update:open')).toBeUndefined()
    expect(wrapper.emitted('sent')).toBeUndefined()
  })

  it('emits close when cancel is clicked', async () => {
    const wrapper = mountDialog()

    const cancelButton = wrapper.findAll('button').find((button) => button.text().trim() === 'Cancel')
    await cancelButton!.trigger('click')

    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })

  it('emits close when the backdrop is clicked', async () => {
    const wrapper = mountDialog()
    await wrapper.find('.absolute.inset-0.bg-black\\/50').trigger('click')
    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })

  it('emits close when the header close button is clicked', async () => {
    const wrapper = mountDialog()
    await wrapper.find('button.text-muted-foreground').trigger('click')
    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })
})
