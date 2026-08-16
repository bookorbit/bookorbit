import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import Button from './Button.vue'

describe('Button destructive variants', () => {
  it.each([
    ['destructive', ['bg-destructive', 'text-destructive-foreground']],
    ['destructive-outline', ['border-destructive/30', 'text-destructive']],
    ['destructive-ghost', ['text-destructive', 'hover:bg-destructive/10']],
  ] as const)('centralizes the %s treatment', (variant, expectedClasses) => {
    const wrapper = mount(Button, { props: { variant } })

    expect(wrapper.attributes('data-variant')).toBe(variant)
    expect(wrapper.classes()).toEqual(expect.arrayContaining([...expectedClasses]))
  })
})
