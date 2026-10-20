import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { BookFileRef, BookSelectionPayload } from '@bookorbit/types'
import SendBookDialog from '../SendBookDialog.vue'

const mockState = vi.hoisted(() => ({
  fetchProviders: vi.fn<() => Promise<void>>(),
  fetchRecipients: vi.fn<() => Promise<void>>(),
  fetchGroups: vi.fn<() => Promise<void>>(),
  fetchTemplates: vi.fn<() => Promise<void>>(),
  fetchPreferences: vi.fn<() => Promise<void>>(),
  sendBook: vi.fn<(payload: unknown) => Promise<{ queued: number }>>(),
  fetchLogPage: vi.fn<(page: number, size: number, filter?: Record<string, unknown>) => Promise<unknown[]>>(),
  push: vi.fn<(to: unknown) => void>(),
  toastSuccess: vi.fn<(message: string) => void>(),
  toastError: vi.fn<(message: string) => void>(),
}))

const providers = ref<Array<Record<string, unknown>>>([])
const recipients = ref<Array<Record<string, unknown>>>([])
const groups = ref<Array<Record<string, unknown>>>([])
const templates = ref<Array<Record<string, unknown>>>([])
const preferences = ref<Record<string, unknown> | null>(null)

vi.mock('../../composables/useEmailProviders', () => ({ useEmailProviders: () => ({ providers, fetchProviders: mockState.fetchProviders }) }))
vi.mock('../../composables/useEmailRecipients', () => ({ useEmailRecipients: () => ({ recipients, fetchRecipients: mockState.fetchRecipients }) }))
vi.mock('../../composables/useEmailGroups', () => ({ useEmailGroups: () => ({ groups, fetchGroups: mockState.fetchGroups }) }))
vi.mock('../../composables/useEmailTemplates', () => ({ useEmailTemplates: () => ({ templates, fetchTemplates: mockState.fetchTemplates }) }))
vi.mock('../../composables/useEmailPreferences', () => ({
  useEmailPreferences: () => ({ preferences, fetchPreferences: mockState.fetchPreferences }),
}))
vi.mock('../../composables/useEmailSend', () => ({ useEmailSend: () => ({ sendBook: mockState.sendBook }) }))
vi.mock('../../composables/useEmailSendLog', () => ({ fetchLogPage: mockState.fetchLogPage }))
vi.mock('@/features/auth/composables/usePermissions', () => ({ usePermissions: () => ({ hasPermission: () => true }) }))
vi.mock('@/features/book/components/BookCoverImage.vue', () => ({ default: { template: '<img alt="" />' } }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: mockState.push }) }))
vi.mock('vue-sonner', () => ({ toast: { success: mockState.toastSuccess, error: mockState.toastError } }))

const EPUB: BookFileRef = { id: 101, format: 'epub', role: 'primary', sizeBytes: 708549 }
const MOBI: BookFileRef = { id: 102, format: 'mobi', role: 'content', sizeBytes: 564929 }

function mountSheet(
  overrides: Partial<{ open: boolean; selectionPayload: BookSelectionPayload; selectedCount: number; bookFiles: BookFileRef[] }> = {},
) {
  return mount(SendBookDialog, {
    props: { open: true, selectionPayload: { bookIds: [12] }, selectedCount: 1, bookTitle: 'Verity', bookFiles: [EPUB, MOBI], ...overrides },
    attachTo: document.body,
  })
}

function buttonByText(text: string): HTMLButtonElement {
  const match = [...document.body.querySelectorAll('button')].find((button) => (button.textContent ?? '').trim() === text)
  if (!match) throw new Error(`no button "${text}"`)
  return match
}
function recipientRow(name: string): HTMLButtonElement {
  const row = [...document.body.querySelectorAll<HTMLButtonElement>('button[role="checkbox"]')].find((button) =>
    (button.textContent ?? '').includes(name),
  )
  if (!row) throw new Error(`no recipient "${name}"`)
  return row
}

describe('SendBookDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    providers.value = [{ id: 3, name: 'Gmail', host: 'smtp.gmail.com' }]
    recipients.value = [
      { id: 10, name: 'Kindle Paperwhite', email: 'reader@kindle.com', deviceType: 'kindle', preferredFormat: 'epub', readAloudDelivery: null },
      { id: 11, name: 'Ana Beck', email: 'ana@example.com', deviceType: null, preferredFormat: 'pdf', readAloudDelivery: null },
    ]
    groups.value = [{ id: 99, name: 'Book club', members: [{ id: 11, name: 'Ana Beck' }] }]
    templates.value = [{ id: 7, name: 'Default', isSystem: true, subject: 'S', bodyText: 'B' }]
    preferences.value = { userId: 1, defaultProviderId: 3, defaultRecipientId: 10, defaultTemplateId: null }
    for (const fn of [
      mockState.fetchProviders,
      mockState.fetchRecipients,
      mockState.fetchGroups,
      mockState.fetchTemplates,
      mockState.fetchPreferences,
    ])
      fn.mockResolvedValue(undefined)
    mockState.sendBook.mockResolvedValue({ queued: 1 })
    mockState.fetchLogPage.mockResolvedValue([])
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('loads everything it needs when opened, and nothing while closed', async () => {
    const wrapper = mountSheet({ open: false })
    expect(mockState.fetchRecipients).not.toHaveBeenCalled()

    await wrapper.setProps({ open: true })
    await flushPromises()

    for (const fn of [
      mockState.fetchProviders,
      mockState.fetchRecipients,
      mockState.fetchGroups,
      mockState.fetchTemplates,
      mockState.fetchPreferences,
    ]) {
      expect(fn).toHaveBeenCalledTimes(1)
    }
  })

  it('opens with the default recipient picked, so Send works straight away', async () => {
    mountSheet()
    await flushPromises()

    expect(recipientRow('Kindle Paperwhite').getAttribute('aria-checked')).toBe('true')
    expect(recipientRow('Ana Beck').getAttribute('aria-checked')).toBe('false')

    buttonByText('Send').click()
    await flushPromises()

    expect(mockState.sendBook).toHaveBeenCalledWith({ bookIds: [12], recipientIds: [10], providerId: 3, templateId: undefined, fileId: undefined })
  })

  it('picks the only recipient when nobody starred one', async () => {
    recipients.value = recipients.value.slice(0, 1)
    groups.value = []
    preferences.value = null
    mountSheet()
    await flushPromises()

    expect(recipientRow('Kindle Paperwhite').getAttribute('aria-checked')).toBe('true')

    buttonByText('Send').click()
    await flushPromises()

    expect(mockState.sendBook).toHaveBeenCalledWith(expect.objectContaining({ recipientIds: [10], providerId: 3 }))
  })

  it('leaves the choice open when several recipients exist and none is starred', async () => {
    preferences.value = null
    mountSheet()
    await flushPromises()

    expect(recipientRow('Kindle Paperwhite').getAttribute('aria-checked')).toBe('false')
    expect(recipientRow('Ana Beck').getAttribute('aria-checked')).toBe('false')
    expect(buttonByText('Send').disabled).toBe(true)
  })

  it('says what a recipient gets only when it differs from the rest', async () => {
    mountSheet()
    await flushPromises()

    expect(recipientRow('Ana Beck').textContent).toContain('No PDF, gets EPUB')
    expect(recipientRow('Kindle Paperwhite').textContent).not.toContain('EPUB')
  })

  it('picks a whole group as its members', async () => {
    mountSheet()
    await flushPromises()

    ;[...document.body.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find((b) => (b.textContent ?? '').includes('Book club'))!.click()
    await flushPromises()

    expect(recipientRow('Ana Beck').getAttribute('aria-checked')).toBe('true')
    buttonByText('Send 2 emails').click()
    await flushPromises()
    expect(mockState.sendBook).toHaveBeenCalledWith(expect.objectContaining({ recipientIds: [10, 11] }))
  })

  it('refuses to send a format a Kindle rejects', async () => {
    mountSheet()
    await flushPromises()

    ;(document.body.querySelector('button[aria-expanded="false"]') as HTMLButtonElement).click()
    await flushPromises()
    const mobi = [...document.body.querySelectorAll<HTMLButtonElement>('button[role="radio"]')].find((b) => (b.textContent ?? '').includes('MOBI'))
    mobi!.click()
    await flushPromises()

    expect(document.body.textContent).toContain("Kindle Paperwhite can't take MOBI")
    expect(buttonByText('Send').disabled).toBe(true)
  })

  it('follows a single book until the mail server accepts it', async () => {
    const now = Date.now()
    mockState.fetchLogPage.mockResolvedValue([
      {
        id: 50,
        toEmail: 'reader@kindle.com',
        status: 'sent',
        attemptCount: 0,
        failureCode: null,
        errorMessage: null,
        createdAt: new Date(now).toISOString(),
        sentAt: new Date(now).toISOString(),
      },
    ])
    const wrapper = mountSheet()
    await flushPromises()

    buttonByText('Send').click()
    await flushPromises()

    expect(mockState.fetchLogPage).toHaveBeenCalledWith(0, 10, { bookId: 12 })
    expect(document.body.textContent).toContain('Sending Verity')
    expect(document.body.querySelector('[role="status"]')?.textContent).toContain('Sent')
    expect(wrapper.emitted('sent')).toEqual([[]])
    expect(wrapper.emitted('update:open')).toBeUndefined()
  })

  it('queues an all-matching selection and closes with a count', async () => {
    const selectionPayload: BookSelectionPayload = { query: { libraryId: 5, q: 'dune', sort: [{ field: 'title', dir: 'asc' }] } }
    mockState.sendBook.mockResolvedValue({ queued: 1833 })
    const wrapper = mountSheet({ selectionPayload, selectedCount: 1833, bookFiles: undefined })
    await flushPromises()

    expect(document.body.textContent).toContain('1,833 books')
    buttonByText('Send').click()
    await flushPromises()

    expect(mockState.sendBook).toHaveBeenCalledWith({
      ...selectionPayload,
      recipientIds: [10],
      providerId: 3,
      templateId: undefined,
      fileId: undefined,
    })
    expect(mockState.toastSuccess).toHaveBeenCalledWith('1,833 emails queued')
    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })

  it('points to setup instead of a dead end when no server exists', async () => {
    providers.value = []
    mountSheet()
    await flushPromises()

    expect(document.body.textContent).toContain('Email is not set up yet')
    buttonByText('Open email settings').click()
    expect(mockState.push).toHaveBeenCalledWith({ name: 'settings-email' })
  })

  it('stays open and says why when sending fails', async () => {
    mockState.sendBook.mockRejectedValueOnce(new Error('No email provider configured'))
    const wrapper = mountSheet()
    await flushPromises()

    buttonByText('Send').click()
    await flushPromises()

    expect(mockState.toastError).toHaveBeenCalledWith('No email provider configured')
    expect(wrapper.emitted('update:open')).toBeUndefined()
  })

  it('closes from Cancel', async () => {
    const wrapper = mountSheet()
    await flushPromises()

    buttonByText('Cancel').click()
    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })
})
