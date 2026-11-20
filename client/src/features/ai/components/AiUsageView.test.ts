import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiUsageReport, AiUsageTotals } from '@bookorbit/types'

import { ApiError } from '@/lib/api-json'
import * as aiApi from '../api/ai.api'
import AiUsageView from './AiUsageView.vue'

const ZERO: AiUsageTotals = {
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cachedTokens: 0,
  costMicros: 0,
  unknownCostRequests: 0,
  errors: 0,
}

const REPORT: AiUsageReport = {
  from: '2026-10',
  to: '2026-11',
  months: [
    { month: '2026-10', ...ZERO, requests: 3, unknownCostRequests: 3 },
    {
      month: '2026-11',
      ...ZERO,
      requests: 40,
      inputTokens: 1_250_000,
      outputTokens: 90_000,
      costMicros: 2_400_000,
      unknownCostRequests: 2,
      errors: 1,
    },
  ],
  byFeature: [{ feature: 'story-guides', ...ZERO, requests: 38, costMicros: 2_300_000 }],
  byModel: [{ model: 'vendor/fast-model', connectionId: 1, connectionName: 'Router', ...ZERO, requests: 38, costMicros: 2_300_000 }],
  costliestJobs: [{ jobId: 'j1', feature: 'story-guides', requests: 30, costMicros: 1_900_000, label: 'Pride and Prejudice' }],
  recentErrors: [
    { at: '2026-11-09T10:00:00.000Z', feature: 'try-it', slot: 'fast', model: 'vendor/fast-model', outcome: 'error:provider-auth', connectionId: 1 },
    { at: '2026-11-08T10:00:00.000Z', feature: 'story-guides', slot: 'careful', model: 'vendor/careful', outcome: 'length', connectionId: 1 },
  ],
}

describe('AiUsageView', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('lists the months newest first, with costs that are partly or wholly unknown', async () => {
    vi.spyOn(aiApi, 'getUsage').mockResolvedValue(REPORT)
    const wrapper = mount(AiUsageView, { attachTo: document.body })
    await flushPromises()

    const rows = wrapper.findAll('[data-testid="ai-usage-months"] tbody tr')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('Nov 2026')
    expect(rows[0]!.text()).toContain('1.3M')
    expect(rows[0]!.text()).toContain('$2.40 + unknown')
    expect(rows[1]!.text()).toContain('Oct 2026')
    expect(rows[1]!.text()).toContain('Unknown')
    expect(wrapper.text()).toContain('Oct 2026 to Nov 2026')
  })

  it('names features, models with their connection, the costliest builds and recent errors', async () => {
    vi.spyOn(aiApi, 'getUsage').mockResolvedValue(REPORT)
    const wrapper = mount(AiUsageView, { attachTo: document.body })
    await flushPromises()

    expect(wrapper.find('[data-testid="ai-usage-features"]').text()).toContain('Story guides for Constellations')
    expect(wrapper.find('[data-testid="ai-usage-models"]').text()).toContain('vendor/fast-model on Router')
    expect(wrapper.find('[data-testid="ai-usage-jobs"]').text()).toContain('Pride and Prejudice')
    const errors = wrapper.find('[data-testid="ai-usage-errors"]').text()
    expect(errors).toContain('Key rejected')
    expect(errors).toContain('Cut short at the output limit')
    expect(errors).toContain('Careful')
  })

  it('exports the same months as CSV, and says when the export fails', async () => {
    vi.spyOn(aiApi, 'getUsage').mockResolvedValue(REPORT)
    const download = vi.spyOn(aiApi, 'downloadUsageCsv').mockResolvedValue()
    const wrapper = mount(AiUsageView, { attachTo: document.body })
    await flushPromises()

    await wrapper.find('[data-testid="ai-usage-export"]').trigger('click')
    await flushPromises()
    expect(download).toHaveBeenCalledWith('2026-10', '2026-11')

    download.mockRejectedValueOnce(new ApiError("Couldn't export the usage.", 500, null, null))
    await wrapper.find('[data-testid="ai-usage-export"]').trigger('click')
    await flushPromises()
    expect((wrapper.find('[data-testid="ai-usage-export"]').element as HTMLButtonElement).disabled).toBe(false)
  })

  it('keeps the way back when the usage cannot load', async () => {
    vi.spyOn(aiApi, 'getUsage').mockRejectedValue(new Error('boom'))
    const wrapper = mount(AiUsageView, { attachTo: document.body })
    await flushPromises()

    expect(wrapper.text()).toContain("Couldn't load the usage.")
    expect((wrapper.find('[data-testid="ai-usage-export"]').element as HTMLButtonElement).disabled).toBe(true)
    await wrapper.find('[data-testid="ai-usage-back"]').trigger('click')
    expect(wrapper.emitted('back')).toHaveLength(1)
  })
})
