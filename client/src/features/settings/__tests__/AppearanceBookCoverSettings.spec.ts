import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import AppearanceBookCoverSettings from '../AppearanceBookCoverSettings.vue'
import { useDisplaySettings } from '@/composables/useDisplaySettings'

const { showSpineOnComics, bookDetailCoverTint } = useDisplaySettings()

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
  bookDetailCoverTint.value = 'single'
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

  it('selects a book detail cover tint mode', async () => {
    const wrapper = mountSettings()

    const section = wrapper.findAll('div').find((d) => d.text().startsWith('Book details cover tint'))
    const buttons = section!.findAll('button')
    expect(buttons.map((b) => b.text())).toEqual([
      'OffPlain card background',
      "One colourThe cover's dominant colour only",
      "Two coloursAdds the cover's accent colour when it has a distinct one",
    ])

    await buttons[2]!.trigger('click')
    expect(bookDetailCoverTint.value).toBe('duotone')

    await buttons[0]!.trigger('click')
    expect(bookDetailCoverTint.value).toBe('off')
  })
})
