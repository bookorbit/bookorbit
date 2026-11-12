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
      fast: { connectionId: 1, model: 'a', prices: null, jsonMode: 'auto', maxOutputTokens: null },
      careful: { connectionId: 1, model: 'b', prices: null, jsonMode: 'auto', maxOutputTokens: null },
      vision: { connectionId: 1, model: 'c', prices: null, jsonMode: 'auto', maxOutputTokens: null },
    },
    slotHealth: {},
    features: [state],
    budget: { monthlyBudget: null, buildsPerMonth: null },
  }
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
    const wrapper = mount(AiFeatureRow, { attachTo: document.body, props: { feature: feature() } })

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
    const wrapper = mount(AiFeatureRow, { attachTo: document.body, props: { feature: confirmed } })
    expect(wrapper.find('[data-testid="ai-feature-privacy"]').text()).toContain('Sending book text confirmed by admin')

    await wrapper.find('[data-testid="ai-feature-switch"]').trigger('click')
    await flushPromises()
    expect(update).toHaveBeenLastCalledWith('story-guides', { enabled: true })

    await wrapper.setProps({ feature: { ...confirmed, settings: { ...confirmed.settings, enabled: true } } })
    await wrapper.find('[data-testid="ai-feature-switch"]').trigger('click')
    await flushPromises()
    expect(update).toHaveBeenLastCalledWith('story-guides', { enabled: false })
  })

  it('checks the limits against the feature range and saves them with its budget share', async () => {
    const update = vi.spyOn(aiApi, 'updateFeature').mockResolvedValue(settingsWith(feature()))
    const wrapper = mount(AiFeatureRow, { attachTo: document.body, props: { feature: feature() } })
    const save = () => wrapper.find('[data-testid="ai-feature-save"]').element as HTMLButtonElement

    await wrapper.find('[data-testid="ai-feature-max-words"]').setValue('5000')
    expect(wrapper.text()).toContain('Enter a whole number from 10,000 to 2,000,000.')
    expect(save().disabled).toBe(true)

    await wrapper.find('[data-testid="ai-feature-max-words"]').setValue('250000')
    await wrapper.find('[data-testid="ai-feature-budget"]').setValue('12.50')
    expect(save().disabled).toBe(false)
    save().click()
    await flushPromises()
    expect(update).toHaveBeenCalledWith('story-guides', {
      limits: { maxWords: 250_000, concurrentBuilds: 1 },
      monthlyBudget: 12.5,
      buildsPerMonth: null,
    })
  })

  it('says which empty slots keep the feature from building', async () => {
    const wrapper = mount(AiFeatureRow, { attachTo: document.body, props: { feature: feature({ missingSlots: ['careful'] }) } })
    expect(wrapper.find('[data-testid="ai-feature-status"]').text()).toContain("Can't build until the Careful slot has a model.")
    clickButton('Go to models')
    await flushPromises()
    expect(wrapper.emitted('showSlot')?.[0]).toEqual(['careful'])
  })

  describe('photo scans, which answer requests instead of building', () => {
    const scans = (overrides: Partial<AiFeatureState> = {}) =>
      feature({ id: 'vision-scan', settings: { enabled: false, limits: {}, monthlyBudget: null, buildsPerMonth: null }, ...overrides })

    it('offers only the budget, and saves only the budget', async () => {
      const update = vi.spyOn(aiApi, 'updateFeature').mockResolvedValue(settingsWith(scans()))
      const wrapper = mount(AiFeatureRow, { attachTo: document.body, props: { feature: scans() } })
      expect(wrapper.find('[data-testid="ai-feature-max-words"]').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('Builds at once')
      expect(wrapper.text()).not.toContain('Builds per month')
      expect(wrapper.find('[data-testid="ai-feature-status"]').text()).toContain("Off. The iOS app doesn't offer it.")

      await wrapper.find('[data-testid="ai-feature-budget"]').setValue('3')
      ;(wrapper.find('[data-testid="ai-feature-save"]').element as HTMLButtonElement).click()
      await flushPromises()
      expect(update).toHaveBeenCalledWith('vision-scan', { monthlyBudget: 3 })
    })

    it('says photos are what leave the server, and that the Vision slot is needed', async () => {
      vi.spyOn(aiApi, 'updateFeature').mockResolvedValue(settingsWith(scans()))
      const wrapper = mount(AiFeatureRow, { attachTo: document.body, props: { feature: scans({ missingSlots: ['vision'] }) } })
      expect(wrapper.find('[data-testid="ai-feature-status"]').text()).toContain("Can't run until the Vision slot has a model.")

      await wrapper.find('[data-testid="ai-feature-switch"]').trigger('click')
      await flushPromises()
      expect(document.body.textContent).toContain('Photos readers take of covers and shelves in the iOS app are sent to the provider you chose')

      const confirmed = mount(AiFeatureRow, {
        props: { feature: scans({ privacy: { userId: 1, username: 'admin', at: '2026-11-09T10:00:00.000Z' } }) },
      })
      expect(confirmed.find('[data-testid="ai-feature-privacy"]').text()).toContain('Sending photos confirmed by admin')
    })
  })
})
