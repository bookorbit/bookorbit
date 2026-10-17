import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { AuditAction, AuditResource, type AuditLogEntry } from '@bookorbit/types'
import { foldAuditEvents } from '../audit-sets'
import AuditEventSheet from '../components/AuditEventSheet.vue'

const passthrough = { template: '<div><slot /></div>' }

function entry(overrides: Partial<AuditLogEntry>): AuditLogEntry {
  return {
    id: 4650,
    userId: null,
    actorUsername: 'system',
    actorName: null,
    action: AuditAction.BookRequestImport,
    resource: AuditResource.BookRequest,
    resourceId: 448,
    description: 'Imported a download for book request #448',
    ip: null,
    meta: { format: 'm4b', sizeBytes: 687486346, downloadId: 325, bookDockFileId: 329 },
    createdAt: '2026-10-14T23:56:00.000Z',
    targetLabel: 'Killing Frost',
    targetExists: true,
    ...overrides,
  }
}

function mountSheet(current: AuditLogEntry, around: AuditLogEntry[] = [], history: AuditLogEntry[] = []) {
  const loadAround = vi.fn<(entry: AuditLogEntry) => Promise<AuditLogEntry[]>>(async () => around)
  const loadHistory = vi.fn<(entry: AuditLogEntry) => Promise<{ events: AuditLogEntry[]; total: number }>>(async () => ({
    events: history,
    total: history.length,
  }))
  const wrapper = mount(AuditEventSheet, {
    props: { set: foldAuditEvents([current])[0]!, loadAround, loadHistory },
    global: { stubs: { Sheet: passthrough, SheetContent: passthrough, SheetTitle: passthrough, SheetDescription: passthrough } },
  })
  return { wrapper, loadAround, loadHistory }
}

describe('AuditEventSheet', () => {
  it('shows who, where, the target and the facts the event carries', async () => {
    const { wrapper } = mountSheet(entry({}))
    await flushPromises()

    const text = wrapper.text()
    expect(text).toContain('Import a book request download')
    expect(text).toContain('System')
    expect(text).toContain('Automation')
    expect(text).toContain('Background job')
    expect(text).toContain('Killing Frost')
    expect(text).toContain('Format')
    expect(text).toContain('M4B')
    expect(text).toContain('655.6 MB')
    expect(text).toContain('#329')
  })

  it('loads what the same person did around it and the target’s history', async () => {
    const current = entry({})
    const before = entry({
      id: 4649,
      userId: 1,
      actorUsername: 'neon',
      actorName: 'Neon',
      action: AuditAction.BookRequestGrab,
      meta: null,
      createdAt: '2026-10-14T23:55:26.000Z',
    })
    const { wrapper, loadAround, loadHistory } = mountSheet(current, [current, before], [before, current])
    await flushPromises()

    expect(loadAround).toHaveBeenCalledWith(current)
    expect(loadHistory).toHaveBeenCalledWith(current)
    expect(wrapper.text()).toContain('Around this event')
    expect(wrapper.text()).toContain('Send book request to a download client')
    expect(wrapper.text()).toContain('This event')

    const aroundButtons = wrapper.findAll('section ol button')
    await aroundButtons[1]!.trigger('click')
    expect(wrapper.emitted('select')?.[0]?.[0]).toMatchObject({ id: 4649 })
  })

  it('says when nothing else happened nearby', async () => {
    const current = entry({})
    const { wrapper } = mountSheet(current, [current])
    await flushPromises()

    expect(wrapper.text()).toContain('Nothing else from System within 40 minutes.')
  })

  it('offers to narrow the log to this person, this target or this address', async () => {
    const current = entry({ userId: 1, actorUsername: 'neon', actorName: 'Neon', ip: '192.168.8.230' })
    const { wrapper } = mountSheet(current)
    await flushPromises()

    const buttons = wrapper.findAll('footer button')
    expect(buttons.map((button) => button.text())).toEqual(['Only Neon', 'Only Killing Frost', 'Only 192.168.8.230'])
    await buttons[0]!.trigger('click')
    await buttons[1]!.trigger('click')
    await buttons[2]!.trigger('click')
    expect(wrapper.emitted('onlyPerson')?.[0]?.[0]).toMatchObject({ id: 4650 })
    expect(wrapper.emitted('onlyTarget')?.[0]).toEqual([expect.objectContaining({ id: 4650 }), 'Killing Frost'])
    expect(wrapper.emitted('onlyIp')?.[0]).toEqual(['192.168.8.230'])
  })
})
