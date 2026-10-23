import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { AuditAction, AuditResource, type AuditLogEntry } from '@bookorbit/types'
import { foldAuditEvents } from '../audit-sets'
import AuditLedgerTable from '../components/AuditLedgerTable.vue'

function entry(overrides: Partial<AuditLogEntry>): AuditLogEntry {
  return {
    id: 1,
    userId: 1,
    actorUsername: 'neon',
    actorName: 'Neon',
    action: AuditAction.LibraryUpdate,
    resource: AuditResource.Library,
    resourceId: 88,
    description: 'Updated library #88',
    ip: '127.0.0.1',
    meta: null,
    createdAt: '2026-10-14T23:07:18.000Z',
    targetLabel: 'KOReader Read-along',
    targetExists: true,
    ...overrides,
  }
}

function mountTable(entries: AuditLogEntry[]) {
  return mount(AuditLedgerTable, { props: { sets: foldAuditEvents(entries), openId: null, unit: 'changes' } })
}

describe('AuditLedgerTable', () => {
  it('shows each folded action with its count, the target name and where it came from', () => {
    const wrapper = mountTable([
      entry({ id: 3, action: AuditAction.LibraryAccessRevoke }),
      entry({ id: 2, action: AuditAction.LibraryAccessGrant }),
      entry({ id: 1, action: AuditAction.LibraryAccessRevoke }),
    ])

    const row = wrapper.findAll('tbody tr')[1]!
    expect(row.text()).toContain('Revoke library access')
    expect(row.text()).toContain('Grant library access')
    expect(row.text()).toContain('KOReader Read-along')
    expect(row.text()).toContain('This server')
    expect(row.text()).toContain('127.0.0.1')
    expect(row.find('td').classes()).toContain('shadow-[inset_2px_0_0_var(--destructive)]')
    expect(wrapper.text()).toContain('3 changes')
  })

  it('marks a target that was deleted later, but not on the event that deleted it', () => {
    const wrapper = mountTable([
      entry({ id: 2, action: AuditAction.LibraryDelete, targetExists: false, createdAt: '2026-10-16T06:15:23.000Z' }),
      entry({ id: 1, targetExists: false }),
    ])

    const rows = wrapper.findAll('tbody tr').filter((row) => row.findAll('td').length > 1)
    expect(rows[0]!.text()).not.toContain('Since deleted')
    expect(rows[1]!.text()).toContain('Since deleted')
  })

  it('names the system and deleted accounts', () => {
    const wrapper = mountTable([
      entry({
        id: 2,
        userId: null,
        actorUsername: 'system',
        actorName: null,
        ip: null,
        action: AuditAction.BookRequestImport,
        resource: AuditResource.BookRequest,
        resourceId: 448,
        targetLabel: 'Killing Frost',
      }),
      entry({ id: 1, userId: null, actorUsername: 'livetest', actorName: null }),
    ])

    expect(wrapper.text()).toContain('System')
    expect(wrapper.text()).toContain('Background job')
    expect(wrapper.text()).toContain('livetest')
    expect(wrapper.text()).toContain('Deleted account')
  })

  it('shows an action this build has no name for by its code', () => {
    const wrapper = mountTable([entry({ action: 'club.create', resource: 'club', resourceId: 13, targetLabel: 'bbb', targetExists: null })])

    expect(wrapper.text()).toContain('club.create')
    expect(wrapper.text()).toContain('bbb')
  })

  it('opens the row it was asked to', async () => {
    const wrapper = mountTable([entry({ id: 7 })])

    await wrapper.find('tbody button').trigger('click')

    expect(wrapper.emitted('open')?.[0]?.[0]).toMatchObject({ id: 7 })
  })
})
