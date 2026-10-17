import { flushPromises, shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuditAction, AuditResource, type AuditLogEntry } from '@bookorbit/types'
import AuditLogPage from '../AuditLogPage.vue'
import AuditEventSheet from '../components/AuditEventSheet.vue'
import AuditHeaderActions from '../components/AuditHeaderActions.vue'
import AuditLedgerTable from '../components/AuditLedgerTable.vue'
import AuditSignInTable from '../components/AuditSignInTable.vue'

const apiMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
const hasPermission = vi.fn<(permission: string) => boolean>()

vi.mock('@/lib/api', () => ({ api: (input: RequestInfo | URL, init?: RequestInit) => apiMock(input, init) }))
vi.mock('@/features/auth/composables/usePermissions', () => ({ usePermissions: () => ({ hasPermission }) }))

function entry(overrides: Partial<AuditLogEntry>): AuditLogEntry {
  return {
    id: 1,
    userId: 1,
    actorUsername: 'neon',
    actorName: 'Neon',
    action: AuditAction.UserPermissionSet,
    resource: AuditResource.User,
    resourceId: 40,
    description: 'Updated permissions for user #40',
    ip: '127.0.0.1',
    meta: null,
    createdAt: '2026-10-14T23:34:52.000Z',
    targetLabel: 'Read-along Reader',
    targetExists: true,
    ...overrides,
  }
}

const ENTRIES = [
  entry({
    id: 4894,
    action: AuditAction.LibraryDelete,
    resource: AuditResource.Library,
    resourceId: 88,
    targetLabel: 'KOReader Read-along',
    targetExists: false,
    createdAt: '2026-10-16T06:15:23.000Z',
  }),
  entry({ id: 4642 }),
  entry({ id: 4641, createdAt: '2026-10-14T23:34:51.000Z' }),
]

const SUMMARY = {
  kinds: { all: 633, changes: 179, signins: 454, security: 29 },
  categories: { libraries: 37, users: 21 },
  securityGroups: { failed: 1, accounts: 15, passwords: 3, permissions: 6, access: 4, links: 0 },
  retentionDays: 90,
  oldestAt: '2026-08-15T04:32:57.206Z',
}

function json(body: unknown) {
  return { ok: true, status: 200, headers: new Headers(), json: async () => body } as unknown as Response
}

function mountPage() {
  return shallowMount(AuditLogPage, { props: { embedded: true }, global: { stubs: { teleport: true } } })
}

function requested(prefix: string) {
  return apiMock.mock.calls.map(([input]) => String(input)).filter((url) => url.startsWith(prefix))
}

describe('AuditLogPage', () => {
  beforeEach(() => {
    hasPermission.mockReturnValue(true)
    apiMock.mockReset()
    apiMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.startsWith('/api/v1/audit-log/summary')) return json(SUMMARY)
      if (url.startsWith('/api/v1/audit-log/actors')) return json([{ userId: 1, username: 'neon', name: 'Neon' }])
      if (url.startsWith('/api/v1/audit-log/sign-ins')) {
        return json({
          data: [
            {
              day: '2026-10-15',
              actorUsername: 'test1',
              actorName: 'test1',
              userId: 2,
              ip: '192.168.8.230',
              signIns: 1,
              signOuts: 1,
              failed: 1,
              failedUsernames: ['test1'],
              firstAt: '2026-10-16T01:49:37.000Z',
              lastAt: '2026-10-16T02:02:59.000Z',
            },
          ],
          total: 1,
        })
      }
      return json({ data: ENTRIES, total: 179 })
    })
  })

  it('opens on Changes with a count on every view', async () => {
    const wrapper = mountPage()
    await flushPromises()

    const views = wrapper.findAll('[role="group"] button')
    expect(views.map((button) => button.text().replace(/\s+/g, ' '))).toEqual(['Changes 179', 'Sign-ins 454', 'Security 29', 'All 633'])
    expect(views[0]!.attributes('aria-pressed')).toBe('true')
  })

  it('folds one person’s back-to-back changes to one target into a single row', async () => {
    const wrapper = mountPage()
    await flushPromises()

    const sets = wrapper.findComponent(AuditLedgerTable).props('sets')
    expect(sets).toHaveLength(2)
    expect(sets[1].items.map((item: AuditLogEntry) => item.id)).toEqual([4642, 4641])
    expect(wrapper.text()).toContain('1–50 of 179 changes')
  })

  it('switches to the folded sign-in table', async () => {
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.findAll('[role="group"] button')[1]!.trigger('click')
    await flushPromises()

    expect(wrapper.findComponent(AuditLedgerTable).exists()).toBe(false)
    expect(wrapper.findComponent(AuditSignInTable).props('groups')).toHaveLength(1)
    expect(requested('/api/v1/audit-log/sign-ins')).toHaveLength(1)
    expect(wrapper.text()).toContain('454 sign-in events, folded into 1 row by person, day and network')
  })

  it('shows the security groups that have events in the Security view', async () => {
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.findAll('[role="group"] button')[2]!.trigger('click')
    await flushPromises()

    const chips = wrapper.find('[aria-label="Security event type"]').findAll('button')
    expect(chips.map((chip) => chip.text().replace(/\s+/g, ' '))).toEqual([
      'Everything 29',
      'Failed sign-ins 1',
      'Accounts 15',
      'Passwords 3',
      'Permissions 6',
      'Library access 4',
    ])
    await chips[1]!.trigger('click')
    await flushPromises()
    expect(requested('/api/v1/audit-log?').at(-1)).toContain('securityGroup=failed')
  })

  it('opens an event and narrows the log to its person from the drawer', async () => {
    const wrapper = mountPage()
    await flushPromises()

    const table = wrapper.findComponent(AuditLedgerTable)
    table.vm.$emit('open', table.props('sets')[0])
    await flushPromises()
    const sheet = wrapper.findComponent(AuditEventSheet)
    expect(sheet.props('set')?.id).toBe(4894)

    sheet.vm.$emit('onlyPerson', ENTRIES[0])
    await flushPromises()

    expect(wrapper.findComponent(AuditEventSheet).props('set')).toBeNull()
    expect(wrapper.find('[aria-label="Remove filter: Neon"]').exists()).toBe(true)
    expect(requested('/api/v1/audit-log?').at(-1)).toContain('actorUsername=neon')
  })

  it('narrows to one target, and Clear all removes every filter', async () => {
    const wrapper = mountPage()
    await flushPromises()

    wrapper.findComponent(AuditEventSheet).vm.$emit('onlyTarget', ENTRIES[0], 'KOReader Read-along')
    await flushPromises()
    expect(wrapper.text()).toContain('Library: KOReader Read-along')
    expect(requested('/api/v1/audit-log?').at(-1)).toContain('resource=library&resourceId=88')

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Clear all')!
      .trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('Library: KOReader Read-along')
  })

  it('offers the retention editor only to people who can change app settings', async () => {
    hasPermission.mockReturnValue(false)
    const wrapper = mountPage()
    await flushPromises()

    const actions = wrapper.findComponent(AuditHeaderActions)
    expect(actions.props()).toMatchObject({ retentionDays: 90, canEditRetention: false })
  })

  it('says when nothing matches the filters', async () => {
    apiMock.mockImplementation(async (input) =>
      String(input).startsWith('/api/v1/audit-log/summary') ? json(SUMMARY) : json({ data: [], total: 0 }),
    )
    const wrapper = mountPage()
    await flushPromises()

    expect(wrapper.text()).toContain('No audit logs found')
  })
})
