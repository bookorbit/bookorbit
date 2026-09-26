import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import NotificationSheet from './NotificationSheet.vue'

vi.mock('../composables/useNotifications', () => ({
  useNotifications: () => ({
    notifications: ref([]),
    unreadCount: ref(0),
    loading: ref(false),
    hasMore: ref(false),
    fetchNotifications: vi.fn<(reset?: boolean) => Promise<void>>().mockResolvedValue(undefined),
    markAsRead: vi.fn<(id: number) => Promise<void>>().mockResolvedValue(undefined),
    markAllAsRead: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    dismiss: vi.fn<(id: number) => Promise<void>>().mockResolvedValue(undefined),
    clearAll: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  }),
}))

const stubs = {
  Button: { template: '<button type="button"><slot /></button>' },
  Sheet: { template: '<div><slot /></div>' },
  SheetTrigger: { template: '<div><slot /></div>' },
  SheetContent: { template: '<div><slot /></div>' },
  SheetDescription: { template: '<div><slot /></div>' },
  SheetHeader: { template: '<div><slot /></div>' },
  SheetTitle: { template: '<div><slot /></div>' },
  Tooltip: { template: '<div><slot /></div>' },
  TooltipTrigger: { template: '<div><slot /></div>' },
  TooltipContent: { template: '<div data-testid="tooltip-content"><slot /></div>' },
  NotificationItemVue: { template: '<div />' },
}

describe('NotificationSheet trigger', () => {
  it('provides an accessible name and matching tooltip', () => {
    const wrapper = mount(NotificationSheet, {
      props: { iconRadiusClass: 'rounded-md' },
      global: { stubs },
    })

    expect(wrapper.get('button').attributes('aria-label')).toBe('Notifications')
    expect(wrapper.get('[data-testid="tooltip-content"]').text()).toBe('Notifications')
  })
})
