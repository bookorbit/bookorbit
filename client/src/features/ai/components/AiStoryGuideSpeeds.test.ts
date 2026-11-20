import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StoryGuideSpeeds } from '@bookorbit/types'

import * as aiApi from '../api/ai.api'
import AiStoryGuideSpeeds from './AiStoryGuideSpeeds.vue'

const SPEEDS: StoryGuideSpeeds = {
  models: [
    {
      connectionId: 3,
      connectionName: 'Home server',
      model: 'fast-model',
      learnedAt: '2026-11-10T12:00:00.000Z',
      steps: [
        { step: 'names', secondsPerCall: 4.2, builds: 3 },
        { step: 'ties', secondsPerCall: 2, builds: 3 },
        { step: 'lines', secondsPerCall: 6.5, builds: 2 },
        { step: 'summaries', secondsPerCall: 3, builds: 1 },
      ],
    },
    {
      connectionId: 4,
      connectionName: null,
      model: 'careful-model',
      learnedAt: '2026-11-09T12:00:00.000Z',
      steps: [{ step: 'review', secondsPerCall: 41, builds: 1 }],
    },
  ],
}

function clickButton(text: string) {
  const button = [...document.body.querySelectorAll('button')].find((element) => element.textContent?.trim() === text)
  if (!button) throw new Error(`No button "${text}"`)
  button.click()
}

function clickButtonIn(selector: string, text: string) {
  const button = [...document.body.querySelectorAll(`${selector} button`)].find((element) => element.textContent?.trim() === text)
  if (!button) throw new Error(`No button "${text}"`)
  ;(button as HTMLButtonElement).click()
}

describe('AiStoryGuideSpeeds', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('lists each model with its connection, what it was learned from, and its time per call by step', async () => {
    vi.spyOn(aiApi, 'getStoryGuideSpeeds').mockResolvedValue(SPEEDS)
    const wrapper = mount(AiStoryGuideSpeeds, { attachTo: document.body })
    await flushPromises()
    const rows = wrapper.findAll('[data-testid="ai-story-guide-speed"]')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('fast-model')
    expect(rows[0]!.text()).toContain('on Home server')
    expect(rows[0]!.text()).toContain('Learned from up to 3 builds')
    expect(rows[0]!.findAll('dt').map((term) => term.text())).toEqual(['Finding names', 'Finding ties', 'Writing descriptions', 'Writing summaries'])
    expect(rows[0]!.findAll('dd').map((value) => value.text())).toEqual(['4.2 sec per call', '2 sec per call', '6.5 sec per call', '3 sec per call'])
    expect(rows[1]!.find('p').text()).toBe('careful-model')
    expect(rows[1]!.text()).toContain('Learned from 1 build')
    expect(rows[1]!.find('[data-testid="ai-story-guide-speed-reset"]').attributes('aria-label')).toBe('Reset the speed of careful-model')
  })

  it('says builds are not timed yet when no build has finished', async () => {
    vi.spyOn(aiApi, 'getStoryGuideSpeeds').mockResolvedValue({ models: [] })
    const wrapper = mount(AiStoryGuideSpeeds, { attachTo: document.body })
    await flushPromises()
    expect(wrapper.find('[data-testid="ai-story-guide-speeds-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ai-story-guide-speed"]').exists()).toBe(false)
  })

  it('resets a model only after confirming, then reads the list again', async () => {
    const load = vi
      .spyOn(aiApi, 'getStoryGuideSpeeds')
      .mockResolvedValueOnce(SPEEDS)
      .mockResolvedValueOnce({ models: [SPEEDS.models[1]!] })
    const reset = vi.spyOn(aiApi, 'resetStoryGuideSpeed').mockResolvedValue({ removed: 3 })
    const wrapper = mount(AiStoryGuideSpeeds, { attachTo: document.body })
    await flushPromises()
    await wrapper.findAll('[data-testid="ai-story-guide-speed-reset"]')[0]!.trigger('click')
    await flushPromises()
    expect(reset).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Builds on fast-model show no time again until one of them finishes.')
    const dialogButtons = [...document.body.querySelectorAll('[role="dialog"] button')]
    const confirm = dialogButtons.find((button) => button.textContent?.trim() === 'Reset')
    if (!confirm) throw new Error('No confirm button')
    ;(confirm as HTMLButtonElement).click()
    await flushPromises()
    expect(reset).toHaveBeenCalledWith({ connectionId: 3, model: 'fast-model', effort: 'auto' })
    expect(load).toHaveBeenCalledTimes(2)
    expect(wrapper.findAll('[data-testid="ai-story-guide-speed"]')).toHaveLength(1)
  })

  it('names the effort a speed was learned at, and resets only that level', async () => {
    const atHigh = { ...SPEEDS.models[1]!, effort: 'high' as const }
    vi.spyOn(aiApi, 'getStoryGuideSpeeds').mockResolvedValue({ models: [SPEEDS.models[1]!, atHigh] })
    const reset = vi.spyOn(aiApi, 'resetStoryGuideSpeed').mockResolvedValue({ removed: 1 })
    const wrapper = mount(AiStoryGuideSpeeds, { attachTo: document.body })
    await flushPromises()
    const rows = wrapper.findAll('[data-testid="ai-story-guide-speed"]')
    expect(rows.map((row) => row.find('p').text())).toEqual(['careful-model', 'careful-model at High effort'])
    const button = rows[1]!.find('[data-testid="ai-story-guide-speed-reset"]')
    expect(button.attributes('aria-label')).toBe('Reset the speed of careful-model at High effort')
    await button.trigger('click')
    await flushPromises()
    clickButtonIn('[role="dialog"]', 'Reset')
    await flushPromises()
    expect(reset).toHaveBeenCalledWith({ connectionId: 4, model: 'careful-model', effort: 'high' })
  })

  it('offers a retry when the list cannot be read', async () => {
    const load = vi.spyOn(aiApi, 'getStoryGuideSpeeds').mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce({ models: [] })
    const wrapper = mount(AiStoryGuideSpeeds, { attachTo: document.body })
    await flushPromises()
    expect(wrapper.text()).toContain("Couldn't read the model speeds.")
    clickButton('Retry')
    await flushPromises()
    expect(load).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid="ai-story-guide-speeds-empty"]').exists()).toBe(true)
  })
})
