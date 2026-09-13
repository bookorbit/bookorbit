import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import TokenSelect from '../TokenSelect.vue'

const OPTIONS = [
  { value: 'de', label: 'German' },
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'French' },
]

function mountSelect(props: Partial<InstanceType<typeof TokenSelect>['$props']> = {}) {
  return mount(TokenSelect, { props: { options: OPTIONS, modelValue: [], inputId: 'tier-languages', ...props } })
}

function optionText(wrapper: ReturnType<typeof mountSelect>) {
  return wrapper.findAll('[role="option"]').map((option) => option.text())
}

async function typeInto(wrapper: ReturnType<typeof mountSelect>, value: string) {
  const input = wrapper.find('input')
  ;(input.element as HTMLInputElement).value = value
  await input.trigger('input')
}

describe('TokenSelect', () => {
  /**
   * The whole reason this replaced `<select multiple>`: Vue stringifies a bound array onto the
   * select, "en,de" matches no option, and the browser clears every selection. Anything past one
   * value has to survive here.
   */
  it('keeps accumulating values past the first', async () => {
    const wrapper = mountSelect()

    await wrapper.find('input').trigger('focus')
    await wrapper.findAll('[role="option"]')[1]?.trigger('mousedown')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([['en']])

    await wrapper.setProps({ modelValue: ['en'] })
    await wrapper.find('input').trigger('focus')
    await wrapper.findAll('[role="option"]')[0]?.trigger('mousedown')

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([['en', 'de']])
  })

  it('shows what is chosen as removable chips, ordered by the option list', async () => {
    const wrapper = mountSelect({ modelValue: ['fr', 'de'] })

    expect(wrapper.text()).toContain('German')
    expect(wrapper.text()).toContain('French')

    await wrapper.get('button[type="button"]').trigger('click')

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([['fr']])
  })

  it('filters on the label and on the code, and hides what is already chosen', async () => {
    const wrapper = mountSelect({ modelValue: ['de'] })

    await wrapper.find('input').trigger('focus')
    expect(optionText(wrapper)).toEqual(['English', 'French'])

    await typeInto(wrapper, 'fr')
    expect(optionText(wrapper)).toEqual(['French'])

    await typeInto(wrapper, 'eng')
    expect(optionText(wrapper)).toEqual(['English'])
  })

  /** A query narrowed to one is unambiguous, so Enter takes it without arrowing to it first. */
  it('adds the only match on Enter', async () => {
    const wrapper = mountSelect()

    await typeInto(wrapper, 'french')
    await wrapper.find('input').trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([['fr']])
  })

  it('walks the list with the arrow keys and reports the active option to assistive technology', async () => {
    const wrapper = mountSelect()

    const input = wrapper.find('input')
    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'ArrowDown' })

    expect(input.attributes('aria-activedescendant')).toBe('tier-languages-option-1')

    await input.trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([['en']])
  })

  it('drops the last chip on Backspace from an empty query', async () => {
    const wrapper = mountSelect({ modelValue: ['de', 'en'] })

    await wrapper.find('input').trigger('keydown', { key: 'Backspace' })

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([['de']])
  })

  it('says so when nothing matches instead of showing an empty list', async () => {
    const wrapper = mountSelect()

    await typeInto(wrapper, 'klingon')

    expect(wrapper.findAll('[role="option"]')).toHaveLength(0)
    expect(wrapper.text()).toContain('No matches')
  })

  it('emits nothing at all while disabled', async () => {
    const wrapper = mountSelect({ modelValue: ['de'], disabled: true })

    await wrapper.find('input').trigger('keydown', { key: 'Backspace' })

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})
