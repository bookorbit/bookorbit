import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiBudgetState, AiSettings } from '@bookorbit/types'

import * as aiApi from '../api/ai.api'
import AiBudgetSection from './AiBudgetSection.vue'

const SETTINGS: AiSettings = {
  slots: {
    fast: { connectionId: 1, model: 'a', prices: null, jsonMode: 'auto', maxOutputTokens: null },
    careful: { connectionId: 1, model: 'b', prices: null, jsonMode: 'auto', maxOutputTokens: null },
    vision: { connectionId: null, model: null, prices: null, jsonMode: 'auto', maxOutputTokens: null },
  },
  slotHealth: {},
  features: [],
  budget: { monthlyBudget: 20, buildsPerMonth: null },
}

const STATE: AiBudgetState = {
  month: '2026-11',
  monthlyBudget: 20,
  spentMicros: 17_000_000,
  reservedMicros: 1_500_000,
  used: 0.85,
  warning: true,
  exhausted: false,
  buildsPerMonth: 10,
  buildsThisMonth: 4,
  countsBuilds: true,
}

describe('AiBudgetSection', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('shows this month against the budget and says when builds are what is counted', () => {
    const wrapper = mount(AiBudgetSection, { props: { settings: SETTINGS, state: 'ready', usage: STATE } })
    const state = wrapper.find('[data-testid="ai-budget-state"]').text()
    expect(state).toContain('$17.00 of $20.00 spent this month (85%).')
    expect(state).toContain('$1.50 is reserved for builds in progress.')
    expect(state).toContain('4 builds of 10 this month.')
    expect(state).toContain("85% of this month's budget is used.")
    expect(wrapper.find('[data-testid="ai-budget-counts-builds"]').exists()).toBe(true)
  })

  it('saves a new budget and clears a limit left empty', async () => {
    const next = { ...SETTINGS, budget: { monthlyBudget: 35, buildsPerMonth: null } }
    const update = vi.spyOn(aiApi, 'updateBudget').mockResolvedValue(next)
    const wrapper = mount(AiBudgetSection, { attachTo: document.body, props: { settings: SETTINGS, state: 'ready', usage: STATE } })

    await wrapper.find('[data-testid="ai-budget-monthly"]').setValue('lots')
    expect(wrapper.text()).toContain('Enter an amount in dollars up to $1,000,000.00, or leave it empty.')
    await wrapper.find('[data-testid="ai-budget-monthly"]').setValue('35')
    await wrapper.find('[data-testid="ai-budget-save"]').trigger('click')
    await flushPromises()

    expect(update).toHaveBeenCalledWith({ monthlyBudget: 35, buildsPerMonth: null })
    expect(wrapper.emitted('updated')?.[0]).toEqual([next])
  })
})
