import { shallowMount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import NotificationPreferences from './NotificationPreferences.vue'

const { loadPrefs, setPopupEnabled } = vi.hoisted(() => ({
  loadPrefs: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  setPopupEnabled: vi.fn<(enabled: boolean) => Promise<void>>().mockResolvedValue(undefined),
}))

vi.mock('@/features/auth/composables/useAuth', () => ({
  useAuth: () => ({
    user: { value: { settings: { notificationPreferences: {} } } },
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

describe('NotificationPreferences', () => {
  it('uses compact spacing between notification groups and their panels', () => {
    const wrapper = shallowMount(NotificationPreferences, { props: { embedded: true } })

    expect(wrapper.find('.space-y-4').exists()).toBe(true)
    const appSection = wrapper.get('section[aria-labelledby="notification-group-app"]')
    expect(appSection.classes()).toContain('space-y-2')
    expect(appSection.get('.settings-group-label').classes()).not.toContain('mb-0')
  })
})
