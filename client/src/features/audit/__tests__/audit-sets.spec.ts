// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { AuditAction, AuditResource, type AuditLogEntry } from '@bookorbit/types'
import { foldAuditEvents, groupByDay, localDayKey } from '../audit-sets'

let nextId = 100
function entry(minute: number, overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: nextId--,
    userId: 1,
    actorUsername: 'neon',
    action: AuditAction.UserPermissionSet,
    resource: AuditResource.User,
    resourceId: 40,
    description: 'Updated permissions',
    ip: '127.0.0.1',
    meta: null,
    createdAt: new Date(2026, 9, 14, 17, minute).toISOString(),
    ...overrides,
  }
}

describe('foldAuditEvents', () => {
  it('folds one person changing one target in quick succession into one row with per-action counts', () => {
    const sets = foldAuditEvents([entry(34), entry(34, { action: AuditAction.UserUpdate }), entry(33), entry(31, { action: AuditAction.UserUpdate })])

    expect(sets).toHaveLength(1)
    expect(sets[0]!.items).toHaveLength(4)
    expect(sets[0]!.actions).toEqual([
      { action: AuditAction.UserPermissionSet, count: 2 },
      { action: AuditAction.UserUpdate, count: 2 },
    ])
  })

  it('starts a new row for another person, another target, or a gap over five minutes', () => {
    const sets = foldAuditEvents([
      entry(40),
      entry(39, { actorUsername: 'test1', userId: 2 }),
      entry(38, { resourceId: 41 }),
      entry(37, { resourceId: 41 }),
      entry(20, { resourceId: 41 }),
    ])

    expect(sets.map((set) => set.items.length)).toEqual([1, 1, 2, 1])
  })

  it('folds untargeted events such as sign-ins across the whole day, per address', () => {
    const signIn = (minute: number, ip = '127.0.0.1') => entry(minute, { action: AuditAction.AuthLogin, resource: null, resourceId: null, ip })
    const sets = foldAuditEvents([signIn(59), signIn(5), signIn(4, '192.168.8.230'), signIn(1, '192.168.8.230')])

    expect(sets.map((set) => set.items.length)).toEqual([2, 2])
  })

  it('never folds across days', () => {
    const late = entry(0, { createdAt: new Date(2026, 9, 15, 0, 1).toISOString() })
    const early = entry(0, { createdAt: new Date(2026, 9, 14, 23, 59).toISOString() })

    const sets = foldAuditEvents([late, early])

    expect(sets).toHaveLength(2)
    expect(sets.map((set) => set.day)).toEqual(['2026-10-15', '2026-10-14'])
  })
})

describe('groupByDay', () => {
  it('keeps order and starts a group whenever the day changes', () => {
    const groups = groupByDay(['2026-10-16', '2026-10-15', '2026-10-15', '2026-10-14'], (day) => day)
    expect(groups.map((group) => [group.day, group.items.length])).toEqual([
      ['2026-10-16', 1],
      ['2026-10-15', 2],
      ['2026-10-14', 1],
    ])
  })
})

describe('localDayKey', () => {
  it('uses the viewer’s calendar day', () => {
    expect(localDayKey(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05')
  })
})
