import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'

import en from '@/locales/en.json'
import NotificationLevelSegmented from './NotificationLevelSegmented.vue'

function mountControl(category: 'scanning' | 'achievements' | 'bookDock', modelValue: 'off' | 'problems' | 'all' = 'all') {
  const i18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages: { en } })
  return mount(NotificationLevelSegmented, {
    props: { modelValue, category, label: 'Library scanning' },
    global: { plugins: [i18n] },
  })
}

describe('NotificationLevelSegmented', () => {
  it('offers all three levels for a category that has failures to report', () => {
    const options = mountControl('scanning').findAll('[role="radio"]')

    expect(options).toHaveLength(3)
    expect(options.map((o) => o.text())).toEqual(['Off', 'Problems', 'All'])
  })

  it('drops the problems level where it would behave identically to off', () => {
    const options = mountControl('achievements').findAll('[role="radio"]')

    expect(options).toHaveLength(2)
    expect(options.map((o) => o.text())).toEqual(['Off', 'All'])
  })

  it('offers problems for partial Book Dock failures', () => {
    const options = mountControl('bookDock').findAll('[role="radio"]')

    expect(options.map((o) => o.text())).toEqual(['Off', 'Problems', 'All'])
  })

  it('marks only the selected level as checked', () => {
    const options = mountControl('scanning', 'problems').findAll('[role="radio"]')

    expect(options.map((o) => o.attributes('aria-checked'))).toEqual(['false', 'true', 'false'])
  })

  it('emits the chosen level', async () => {
    const wrapper = mountControl('scanning', 'all')

    await wrapper.findAll('[role="radio"]')[1]!.trigger('click')

    expect(wrapper.emitted('update:modelValue')).toEqual([['problems']])
  })

  it('exposes a group label and per-option labels for assistive technology', () => {
    const wrapper = mountControl('scanning')

    expect(wrapper.get('[role="radiogroup"]').attributes('aria-label')).toBe('Library scanning')
    expect(wrapper.findAll('[role="radio"]')[0]!.attributes('aria-label')).toContain('Library scanning')
  })
})
