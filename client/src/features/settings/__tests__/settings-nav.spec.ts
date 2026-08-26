import { describe, expect, it } from 'vitest'
import type { RouteRecordRaw } from 'vue-router'
import { BookMarked, Highlighter, LibraryBig } from '@lucide/vue'
import { Permission } from '@bookorbit/types'
import { routes } from '@/router'
import { SETTINGS_NAV, findSettingsNavItem, firstVisibleSettingsRoute, visibleSettingsNav, type SettingsNavContext } from '../lib/settings-nav'

const NOBODY: SettingsNavContext = { isSuperuser: false, permissions: [], isDemoRestricted: false }
const SUPERUSER: SettingsNavContext = { isSuperuser: true, permissions: [], isDemoRestricted: false }

/** Detail pages reached from a list, not destinations in the rail. */
const NON_NAV_ROUTES = new Set(['settings-admin-shared-insights'])

function settingsRouteNames(): string[] {
  const settingsRoot = routes.flatMap((route) => route.children ?? []).find((route: RouteRecordRaw) => route.path === '/settings')
  const children = settingsRoot?.children ?? []
  return children.filter((child) => child.name && !child.redirect).map((child) => String(child.name))
}

function navRouteNames(): string[] {
  return SETTINGS_NAV.flatMap((group) =>
    group.items.flatMap((item) => (item.children?.length ? item.children.map((child) => child.routeName) : [item.routeName])),
  )
}

describe('settings navigation model', () => {
  it('points every rail destination at a real route', () => {
    const routeNames = new Set(settingsRouteNames())
    const missing = navRouteNames().filter((name) => !routeNames.has(name))
    expect(missing).toEqual([])
  })

  it('exposes every settings page somewhere in the rail', () => {
    const navNames = new Set(navRouteNames())
    const orphans = settingsRouteNames().filter((name) => !navNames.has(name) && !NON_NAV_ROUTES.has(name))
    expect(orphans).toEqual([])
  })

  it('never lists the same destination twice', () => {
    const names = navRouteNames()
    expect(new Set(names).size).toBe(names.length)
  })

  it('gives book integrations distinct provider-relevant icons', () => {
    expect(findSettingsNavItem('settings-hardcover')?.item.icon).toBe(BookMarked)
    expect(findSettingsNavItem('settings-readwise')?.item.icon).toBe(Highlighter)
    expect(findSettingsNavItem('settings-storygraph')?.item.icon).toBe(LibraryBig)
  })
})

describe('visibleSettingsNav', () => {
  it('drops groups with no reachable destination', () => {
    expect(visibleSettingsNav(NOBODY).map((group) => group.id)).toEqual(['you'])
  })

  it('keeps every group for a superuser', () => {
    expect(visibleSettingsNav(SUPERUSER).map((group) => group.id)).toEqual(['you', 'library', 'devices', 'accounts', 'server'])
  })

  it('hides notifications without notification access', () => {
    const you = visibleSettingsNav(NOBODY)[0]
    expect(you?.items.map((item) => item.id)).not.toContain('notifications')
  })

  it('shows notifications with notification access or superuser status', () => {
    const permitted = visibleSettingsNav({ ...NOBODY, permissions: [Permission.NotificationAccess] })[0]
    const superuser = visibleSettingsNav(SUPERUSER)[0]

    expect(permitted?.items.map((item) => item.id)).toContain('notifications')
    expect(superuser?.items.map((item) => item.id)).toContain('notifications')
  })

  it('hides notifications from demo-restricted accounts even when otherwise allowed', () => {
    const permittedDemo = visibleSettingsNav({
      ...NOBODY,
      permissions: [Permission.NotificationAccess],
      isDemoRestricted: true,
    })[0]
    const superuserDemo = visibleSettingsNav({ ...SUPERUSER, isDemoRestricted: true })[0]

    expect(permittedDemo?.items.map((item) => item.id)).not.toContain('notifications')
    expect(superuserDemo?.items.map((item) => item.id)).not.toContain('notifications')
  })

  it('only exposes the metadata pages the permission allows', () => {
    const library = visibleSettingsNav({ ...NOBODY, permissions: ['manage_libraries'] }).find((group) => group.id === 'library')
    const ids = library?.items.map((item) => item.id) ?? []
    const metadataChildren = library?.items.find((item) => item.id === 'metadata')?.children?.map((child) => child.id) ?? []

    expect(ids).toContain('libraries')
    expect(metadataChildren).toContain('metadata-custom-fields')
    expect(metadataChildren).not.toContain('metadata-providers')
  })

  it('drops a grouping row once every child behind it is hidden', () => {
    const library = visibleSettingsNav({ ...NOBODY, permissions: ['manage_app_settings'] }).find((group) => group.id === 'library')
    expect(library?.items.map((item) => item.id)).not.toContain('metadata')

    const server = visibleSettingsNav({ ...NOBODY, permissions: [Permission.ManageBookDock] }).find((group) => group.id === 'server')
    expect(server?.items.map((item) => item.id)).not.toContain('users-access')
  })

  it('keeps a grouping row when a single child survives', () => {
    const server = visibleSettingsNav({ ...NOBODY, permissions: ['manage_users'] }).find((group) => group.id === 'server')
    const access = server?.items.find((item) => item.id === 'users-access')
    expect(access?.children?.map((child) => child.id)).toEqual(['users'])
  })
})

describe('findSettingsNavItem', () => {
  it('resolves a top level destination with its group', () => {
    const match = findSettingsNavItem('settings-libraries')
    expect(match?.group.id).toBe('library')
    expect(match?.item.id).toBe('libraries')
    expect(match?.parent).toBeUndefined()
  })

  it('resolves a nested destination with its parent', () => {
    const match = findSettingsNavItem('settings-appearance-layout')
    expect(match?.group.id).toBe('you')
    expect(match?.item.id).toBe('appearance-layout')
    expect(match?.parent?.id).toBe('appearance')
  })

  it('returns null for routes outside the rail', () => {
    expect(findSettingsNavItem('settings-admin-shared-insights')).toBeNull()
    expect(findSettingsNavItem(undefined)).toBeNull()
  })
})

describe('firstVisibleSettingsRoute', () => {
  it('returns a destination the user can actually open', () => {
    expect(firstVisibleSettingsRoute(NOBODY)).toBe('settings-account-profile')
  })
})
