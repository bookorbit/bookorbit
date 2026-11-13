import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiFeatureState, AiSettings } from '@bookorbit/types'

import * as aiApi from '../api/ai.api'
import AiFeatureRow from './AiFeatureRow.vue'

function feature(overrides: Partial<AiFeatureState> = {}): AiFeatureState {
  return {
    id: 'story-guides',
    settings: { enabled: false, limits: { maxWords: 400_000, concurrentBuilds: 1 }, monthlyBudget: null, buildsPerMonth: null },
    privacy: null,
    missingSlots: [],
    ...overrides,
  }
}

function settingsWith(state: AiFeatureState): AiSettings {
  return {
    slots: {
      fast: { connectionId: 1, model: 'a', prices: null, jsonMode: 'auto', maxOutputTokens: null, effort: 'auto' },
      careful: { connectionId: 1, model: 'b', prices: null, jsonMode: 'auto', maxOutputTokens: null, effort: 'auto' },
      vision: { connectionId: 1, model: 'c', prices: null, jsonMode: 'auto', maxOutputTokens: null, effort: 'auto' },
    },
    slotHealth: {},
    features: [state],
    budget: { monthlyBudget: null, buildsPerMonth: null },
  }
}

function mountRow(state: AiFeatureState, props: Record<string, unknown> = {}, attach = true) {
  return mount(AiFeatureRow, {
    ...(attach ? { attachTo: document.body } : {}),
    props: { feature: state, open: true, failingSlot: null, month: null, ...props },
  })
}

function clickButton(text: string) {
  const button = [...document.body.querySelectorAll('button')].find((element) => element.textContent?.trim() === text)
  if (!button) throw new Error(`No button "${text}"`)
  button.click()
}

describe('AiFeatureRow', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('asks the admin to confirm what is sent before turning a feature on the first time', async () => {
    const on = feature({
      settings: { ...feature().settings, enabled: true },
      privacy: { userId: 1, username: 'admin', at: '2026-11-09T10:00:00.000Z' },
    })
    const update = vi.spyOn(aiApi, 'updateFeature').mockResolvedValue(settingsWith(on))
    const wrapper = mountRow(feature())

    await wrapper.find('[data-testid="ai-feature-switch"]').trigger('click')
    await flushPromises()
    expect(update).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('The whole text of each book built is sent to the provider you chose.')
    expect(document.body.textContent).toContain("Readers' accounts, reading positions and notes are not.")

    clickButton('Turn on')
    await flushPromises()
    expect(update).toHaveBeenCalledWith('story-guides', { enabled: true, confirmPrivacy: true })
    expect(wrapper.emitted('updated')?.[0]).toEqual([settingsWith(on)])
  })

  it('turns a feature on without asking again once confirmed, and off plainly', async () => {
    const confirmed = feature({ privacy: { userId: 1, username: 'admin', at: '2026-11-09T10:00:00.000Z' } })
    const update = vi.spyOn(aiApi, 'updateFeature').mockResolvedValue(settingsWith(confirmed))
    const wrapper = mountRow(confirmed)
    expect(wrapper.find('[data-testid="ai-feature-privacy"]').text()).toContain('Sending book text confirmed by admin')

    await wrapper.find('[data-testid="ai-feature-switch"]').trigger('click')
    await flushPromises()
    expect(update).toHaveBeenLastCalledWith('story-guides', { enabled: true })

    await wrapper.setProps({ feature: { ...confirmed, settings: { ...confirmed.settings, enabled: true } } })
    await wrapper.find('[data-testid="ai-feature-switch"]').trigger('click')
    await flushPromises()
    expect(update).toHaveBeenLastCalledWith('story-guides', { enabled: false })
  })

  it('checks the limits against the feature range and saves only the feature limits', async () => {
    const update = vi.spyOn(aiApi, 'updateFeature').mockResolvedValue(settingsWith(feature()))
    const wrapper = mountRow(feature())
    const save = () => wrapper.find('[data-testid="ai-feature-save"]').element as HTMLButtonElement
    expect(wrapper.find('[data-testid="ai-feature-budget"]').exists()).toBe(false)

    await wrapper.find('[data-testid="ai-feature-max-words"]').setValue('5000')
    expect(wrapper.text()).toContain('Enter a whole number from 10,000 to 2,000,000.')
    expect(save().disabled).toBe(true)

    await wrapper.find('[data-testid="ai-feature-max-words"]').setValue('250000')
    expect(save().disabled).toBe(false)
    save().click()
    await flushPromises()
    expect(update).toHaveBeenCalledWith('story-guides', { limits: { maxWords: 250_000, concurrentBuilds: 1 } })
    expect(wrapper.emitted('setOpen')?.[0]).toEqual([false])
  })

  it('sums up a closed feature: its slots, limits and this month', async () => {
    const wrapper = mountRow(feature({ settings: { ...feature().settings, enabled: true } }), {
      open: false,
      month: { costMicros: 18_040_000, count: 22 },
    })
    expect(wrapper.find('[data-testid="ai-feature-editor"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="ai-feature-state"]').text()).toBe('On · sends whole book text')
    expect(wrapper.text()).toContain('Fast')
    expect(wrapper.text()).toContain('Careful')
    expect(wrapper.find('[data-testid="ai-feature-limits"]').text()).toBe('Books up to 400,000 words, 1 build at a time')
    expect(wrapper.find('[data-testid="ai-feature-month"]').text()).toContain('$18.04')
    expect(wrapper.find('[data-testid="ai-feature-month"]').text()).toContain('22 builds')

    const toggle = wrapper.find('[data-testid="ai-feature-toggle"]')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    await toggle.trigger('click')
    expect(wrapper.emitted('setOpen')?.[0]).toEqual([true])
  })

  it('says which empty slots keep the feature from building, and keeps it off', async () => {
    const wrapper = mountRow(feature({ missingSlots: ['careful'] }))
    expect(wrapper.find('[data-testid="ai-feature-status"]').text()).toContain("Can't build until the Careful slot has a model.")
    expect(wrapper.find('[data-testid="ai-feature-switch"]').attributes('disabled')).toBeDefined()
    clickButton('Go to models')
    await flushPromises()
    expect(wrapper.emitted('openSlot')?.[0]).toEqual(['careful'])
  })

  it('says when a slot it needs is failing, and links to it', async () => {
    const wrapper = mountRow(feature({ settings: { ...feature().settings, enabled: true } }), { failingSlot: 'fast' })
    expect(wrapper.find('[data-testid="ai-feature-state"]').text()).toContain('Failing')
    expect(wrapper.find('[data-testid="ai-feature-status"]').text()).toContain('The Fast slot is failing')
    clickButton('Go to Fast')
    await flushPromises()
    expect(wrapper.emitted('openSlot')?.[0]).toEqual(['fast'])
  })

  describe('photo scans, which answer requests instead of building', () => {
    const scans = (overrides: Partial<AiFeatureState> = {}) =>
      feature({ id: 'vision-scan', settings: { enabled: false, limits: {}, monthlyBudget: null, buildsPerMonth: null }, ...overrides })

    it('has no limits of its own; its monthly limit is under Spending', () => {
      const wrapper = mountRow(scans())
      expect(wrapper.find('[data-testid="ai-feature-max-words"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="ai-feature-save"]').exists()).toBe(false)
      expect(wrapper.text()).toContain('Photo scans has no limits of its own. Its monthly limit is under Spending.')
      expect(wrapper.find('[data-testid="ai-feature-limits"]').text()).toBe('None of its own')
    })

    it('says photos are what leave the server, and that the Vision slot is needed', async () => {
      vi.spyOn(aiApi, 'updateFeature').mockResolvedValue(settingsWith(scans()))
      const missing = mountRow(scans({ missingSlots: ['vision'] }), {}, false)
      expect(missing.find('[data-testid="ai-feature-status"]').text()).toContain("Can't run until the Vision slot has a model.")

      const wrapper = mountRow(scans())
      await wrapper.find('[data-testid="ai-feature-switch"]').trigger('click')
      await flushPromises()
      expect(document.body.textContent).toContain('Photos readers take of covers and shelves in the iOS app are sent to the provider you chose')

      const confirmed = mountRow(scans({ privacy: { userId: 1, username: 'admin', at: '2026-11-09T10:00:00.000Z' } }), {}, false)
      expect(confirmed.find('[data-testid="ai-feature-privacy"]').text()).toContain('Sending photos confirmed by admin')
    })
  })

  describe('reading help, which each reader uses on their own', () => {
    const help = (overrides: Partial<AiFeatureState> = {}) =>
      feature({
        id: 'reading-help',
        settings: { enabled: false, limits: {}, monthlyBudget: null, buildsPerMonth: null, readerMonthlyBudget: 1, readerRequestsPerMonth: 300 },
        ...overrides,
      })

    it('offers both reader caps, and saves them', async () => {
      const update = vi.spyOn(aiApi, 'updateFeature').mockResolvedValue(settingsWith(help()))
      const wrapper = mountRow(help())
      expect(wrapper.text()).not.toContain('Builds per month')
      const budget = wrapper.find('[data-testid="ai-feature-reader-budget"]')
      const requests = wrapper.find('[data-testid="ai-feature-reader-requests"]')
      expect((budget.element as HTMLInputElement).value).toBe('1')
      expect((requests.element as HTMLInputElement).value).toBe('300')

      await budget.setValue('0.5')
      await requests.setValue('')
      ;(wrapper.find('[data-testid="ai-feature-save"]').element as HTMLButtonElement).click()
      await flushPromises()
      expect(update).toHaveBeenCalledWith('reading-help', { readerMonthlyBudget: 0.5, readerRequestsPerMonth: null })
    })

    it('refuses a reader cap out of range', async () => {
      const wrapper = mountRow(help())
      await wrapper.find('[data-testid="ai-feature-reader-requests"]').setValue('0')
      expect(wrapper.find('[data-testid="ai-feature-save"]').attributes('disabled')).toBeDefined()
      expect(wrapper.find('[data-testid="ai-feature-reader-requests"]').attributes('aria-invalid')).toBe('true')
    })

    it('says passages are what leave the server', async () => {
      vi.spyOn(aiApi, 'updateFeature').mockResolvedValue(settingsWith(help()))
      const wrapper = mountRow(help())
      await wrapper.find('[data-testid="ai-feature-switch"]').trigger('click')
      await flushPromises()
      expect(document.body.textContent).toContain(
        "Passages from before each reader's place, and the words they ask about, are sent to the provider you chose.",
      )
    })

    it('shows no reader caps for a feature that has none', () => {
      const wrapper = mountRow(feature(), {}, false)
      expect(wrapper.find('[data-testid="ai-feature-reader-budget"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="ai-feature-reader-requests"]').exists()).toBe(false)
    })
  })
})
