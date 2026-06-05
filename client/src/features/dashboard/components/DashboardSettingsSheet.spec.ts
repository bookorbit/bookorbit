import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, ref, type Ref } from 'vue'
import type { WidgetConfig } from '@bookorbit/types'

type UseSmartScopesMock = () => {
  smartScopes: Ref<unknown[]>
  fetchSmartScopes: () => void
}

type UseDashboardWidgetsMock = () => {
  widgets: Ref<WidgetConfig[]>
  saveWidgets: (widgets: WidgetConfig[]) => Promise<void>
  WIDGET_LABELS: Record<string, string>
  DEFAULT_WIDGETS: WidgetConfig[]
}

vi.mock('@/components/ui/sheet', () => {
  const passthrough = { template: '<div><slot /></div>' }
  return {
    Sheet: { props: ['open'], emits: ['update:open'], template: '<div><slot /></div>' },
    SheetContent: passthrough,
    SheetHeader: passthrough,
    SheetTitle: passthrough,
  }
})

vi.mock('@/features/smart-scope/composables/useSmartScopes', () => ({
  useSmartScopes: vi.fn<UseSmartScopesMock>(() => ({
    smartScopes: ref<unknown[]>([]),
    fetchSmartScopes: vi.fn<() => void>(),
  })),
}))

vi.mock('../composables/useDashboardWidgets', () => ({
  useDashboardWidgets: vi.fn<UseDashboardWidgetsMock>(() => ({
    widgets: ref<WidgetConfig[]>([]),
    saveWidgets: vi.fn<(widgets: WidgetConfig[]) => Promise<void>>(),
    WIDGET_LABELS: {},
    DEFAULT_WIDGETS: [],
  })),
}))

import DashboardSettingsSheet from './DashboardSettingsSheet.vue'

describe('DashboardSettingsSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('includes continue-listening and want-to-read in the shelf selector', async () => {
    const wrapper = mount(DashboardSettingsSheet, {
      props: { open: false },
    })

    await wrapper.setProps({ open: true })
    await nextTick()
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Shelves')
      ?.trigger('click')

    const optionLabels = wrapper
      .find('select')
      .findAll('option')
      .map((option) => option.text())

    expect(optionLabels).toContain('Continue Listening')
    expect(optionLabels).toContain('Want to Read')
  })
})
