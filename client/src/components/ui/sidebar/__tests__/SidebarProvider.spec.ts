import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SidebarProvider from '../SidebarProvider.vue'
import { useSidebar } from '../utils'

const { readDeviceValue, writeDeviceValue } = vi.hoisted(() => ({
  readDeviceValue: vi.fn<<T>(suffix: string, fallback: T) => T>(),
  writeDeviceValue: vi.fn<<T>(suffix: string, value: T) => void>(),
}))

vi.mock('@/composables/useSidebarPrefs', () => ({
  useSidebarPrefs: () => ({
    readDeviceValue,
    writeDeviceValue,
  }),
}))

const SidebarStateProbe = defineComponent({
  setup() {
    return useSidebar()
  },
  template: '<button type="button" :data-state="state" @click="toggleSidebar">Toggle</button>',
})

describe('SidebarProvider', () => {
  beforeEach(() => {
    readDeviceValue.mockReturnValue(false)
    writeDeviceValue.mockReset()
  })

  it('manages open state when the open prop is omitted', async () => {
    const wrapper = mount(SidebarProvider, {
      slots: {
        default: SidebarStateProbe,
      },
      global: {
        stubs: {
          TooltipProvider: {
            template: '<div><slot /></div>',
          },
        },
      },
    })
    const trigger = wrapper.get('button')

    expect(trigger.attributes('data-state')).toBe('expanded')

    await trigger.trigger('click')
    expect(trigger.attributes('data-state')).toBe('collapsed')
    expect(writeDeviceValue).toHaveBeenLastCalledWith('collapsed', true)

    await trigger.trigger('click')
    expect(trigger.attributes('data-state')).toBe('expanded')
    expect(writeDeviceValue).toHaveBeenLastCalledWith('collapsed', false)
  })
})
