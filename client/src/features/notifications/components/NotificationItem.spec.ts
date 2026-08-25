import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'

import type { NotificationItem } from '@bookorbit/types'
import en from '@/locales/en.json'
import NotificationItemVue from './NotificationItem.vue'

describe('NotificationItem', () => {
  it('renders a persisted notification type that is no longer in the registry', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: { template: '<div />' } }],
    })
    await router.push('/')
    await router.isReady()
    const i18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages: { en } })
    const notification: NotificationItem = {
      id: 1,
      type: 'legacy_notification_type' as NotificationItem['type'],
      title: 'Legacy notification',
      message: null,
      actionUrl: null,
      meta: null,
      read: false,
      count: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }

    const wrapper = mount(NotificationItemVue, {
      props: { notification },
      global: { plugins: [router, i18n] },
    })

    expect(wrapper.text()).toContain('Legacy notification')
  })
})
