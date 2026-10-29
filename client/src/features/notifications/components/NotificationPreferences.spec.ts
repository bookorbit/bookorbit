import { shallowMount } from '@vue/test-utils'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Permission } from '@bookorbit/types'
import { activateI18nLocale, i18n } from '@/i18n'

import NotificationPreferences from './NotificationPreferences.vue'

const { loadPrefs, setPopupEnabled, account } = vi.hoisted(() => ({
  loadPrefs: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  setPopupEnabled: vi.fn<(enabled: boolean) => Promise<void>>().mockResolvedValue(undefined),
  account: {
    value: { isSuperuser: false, permissions: [] as string[], settings: { notificationPreferences: {} } },
  },
}))

vi.mock('@/features/auth/composables/useAuth', () => ({
  useAuth: () => ({
    user: account,
    me: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  }),
}))

vi.mock('@/features/whats-new/composables/useWhatsNew', () => ({
  useWhatsNew: () => ({
    popupEnabled: { value: true },
    setPopupEnabled,
    loadPrefs,
  }),
}))

const t = i18n.global.t

function categoryLabels(wrapper: ReturnType<typeof shallowMount>): string[] {
  return wrapper.findAll('.settings-label').map((label) => label.text())
}

beforeAll(() => {
  activateI18nLocale('en')
})

beforeEach(() => {
  account.value = { isSuperuser: false, permissions: [], settings: { notificationPreferences: {} } }
})

describe('NotificationPreferences', () => {
  it('uses compact spacing between notification groups and their panels', () => {
    const wrapper = shallowMount(NotificationPreferences, { props: { embedded: true } })

    expect(wrapper.find('.space-y-4').exists()).toBe(true)
    const appSection = wrapper.get('section[aria-labelledby="notification-group-app"]')
    expect(appSection.classes()).toContain('space-y-2')
    expect(appSection.get('.settings-group-label').classes()).not.toContain('mb-0')
  })

  it('hides read-aloud notifications from someone who cannot start a read-aloud', () => {
    const wrapper = shallowMount(NotificationPreferences, { props: { embedded: true } })

    expect(categoryLabels(wrapper)).not.toContain(t('notifications.preferences.categories.readAloud.label'))
    expect(categoryLabels(wrapper)).toContain(t('notifications.preferences.categories.fileRename.label'))
  })

  it('offers read-aloud notifications with the permission, and to a superuser', () => {
    account.value = { ...account.value, permissions: [Permission.LibraryGenerateReadAloud] }
    const permitted = shallowMount(NotificationPreferences, { props: { embedded: true } })
    expect(categoryLabels(permitted)).toContain(t('notifications.preferences.categories.readAloud.label'))

    account.value = { ...account.value, isSuperuser: true, permissions: [] }
    const superuser = shallowMount(NotificationPreferences, { props: { embedded: true } })
    expect(categoryLabels(superuser)).toContain(t('notifications.preferences.categories.readAloud.label'))
  })

  it('hides read-aloud notifications from a demo-restricted account even with the permission', () => {
    account.value = { ...account.value, permissions: [Permission.LibraryGenerateReadAloud, Permission.DemoRestricted] }
    const wrapper = shallowMount(NotificationPreferences, { props: { embedded: true } })

    expect(categoryLabels(wrapper)).not.toContain(t('notifications.preferences.categories.readAloud.label'))
  })
})
