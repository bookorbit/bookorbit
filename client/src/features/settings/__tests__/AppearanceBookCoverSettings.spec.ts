import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import AppearanceBookCoverSettings from '../AppearanceBookCoverSettings.vue'
import { useDisplaySettings } from '@/composables/useDisplaySettings'

const { showSpineOnComics } = useDisplaySettings()

const ToggleSwitchStub = {
  name: 'ToggleSwitch',
  props: ['modelValue'],
  emits: ['update:modelValue'],
  template: '<button data-testid="toggle" :data-on="modelValue" @click="$emit(\'update:modelValue\', !modelValue)" />',
}

function mountSettings() {
  return mount(AppearanceBookCoverSettings, {
    global: {
      stubs: { ToggleSwitch: ToggleSwitchStub },
    },
  })
}

afterEach(() => {
  showSpineOnComics.value = false
})

describe('AppearanceBookCoverSettings', () => {
  it('reflects and toggles showSpineOnComics from the dedicated switch', async () => {
    const wrapper = mountSettings()

    const row = wrapper.findAll('.flex.items-center.justify-between').find((r) => r.text().includes('Show spine on comics'))
    expect(row).toBeTruthy()

    const toggle = row!.find('[data-testid="toggle"]')
    expect(toggle.attributes('data-on')).toBe('false')

    await toggle.trigger('click')
    expect(showSpineOnComics.value).toBe(true)
  })
})
