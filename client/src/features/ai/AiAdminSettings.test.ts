import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiConnection, AiOverview, AiSettings, AiSlotSettings, AiUsageReport } from '@bookorbit/types'

import { ApiError } from '@/lib/api-json'
import * as aiApi from './api/ai.api'
import AiAdminSettings from './AiAdminSettings.vue'

const EMPTY_SLOT: AiSlotSettings = { connectionId: null, model: null, prices: null, jsonMode: 'auto', maxOutputTokens: null, effort: 'auto' }

function connection(overrides: Partial<AiConnection> = {}): AiConnection {
  return {
    id: 1,
    name: 'Router',
    apiType: 'openai-chat',
    usable: true,
    baseUrl: 'https://openrouter.ai/api/v1',
    hasKey: true,
    keyHint: '3f9a',
    headers: [],
    networkProfile: null,
    timeoutMs: 120_000,
    maxParallel: 8,
    requestsPerMinute: null,
    status: 'untested',
    lastTest: null,
    failingSince: null,
    failingCode: null,
    failingReason: null,
    month: { requests: 12, costMicros: 420_000 },
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  }
}

const OVERVIEW: AiOverview = {
  encryptionConfigured: true,
  month: { month: '2026-11', requests: 12, errors: 0, costMicros: 420_000, unknownCostRequests: 0 },
  budget: {
    month: '2026-11',
    monthlyBudget: null,
    spentMicros: 420_000,
    reservedMicros: 0,
    used: null,
    warning: false,
    exhausted: false,
    buildsPerMonth: null,
    buildsThisMonth: 0,
    countsBuilds: false,
  },
  failingConnections: [],
  failingSlots: [],
}

function settings(fastConnectionId: number | null = null): AiSettings {
  return {
    slots: {
      fast: fastConnectionId === null ? EMPTY_SLOT : { ...EMPTY_SLOT, connectionId: fastConnectionId, model: 'model-a' },
      careful: EMPTY_SLOT,
      vision: EMPTY_SLOT,
    },
    slotHealth: {},
    features: [
      {
        id: 'story-guides',
        settings: { enabled: false, limits: { maxWords: 400_000, concurrentBuilds: 1 }, monthlyBudget: null, buildsPerMonth: null },
        privacy: null,
        missingSlots: ['fast', 'careful'],
      },
    ],
    budget: { monthlyBudget: null, buildsPerMonth: null },
  }
}

function usageRow(feature: string, costMicros: number, requests: number) {
  return { feature, requests, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0, costMicros, unknownCostRequests: 0, errors: 0 }
}

const MONTH_USAGE: AiUsageReport = {
  from: '2026-11',
  to: '2026-11',
  months: [],
  byFeature: [usageRow('story-guides', 300_000, 40), usageRow('connection-test', 10_000, 2), usageRow('try-it', 20_000, 1)],
  byModel: [],
  costliestJobs: [],
  recentErrors: [],
}

function stubApi(options: { connections?: AiConnection[]; overview?: AiOverview | Error; settings?: AiSettings } = {}) {
  const overview = options.overview ?? OVERVIEW
  vi.spyOn(aiApi, 'getOverview').mockImplementation(() => (overview instanceof Error ? Promise.reject(overview) : Promise.resolve(overview)))
  vi.spyOn(aiApi, 'listConnections').mockResolvedValue(options.connections ?? [])
  vi.spyOn(aiApi, 'getSettings').mockResolvedValue(options.settings ?? settings())
  vi.spyOn(aiApi, 'listModels').mockResolvedValue({ listed: true, models: [{ id: 'model-a' }] })
  vi.spyOn(aiApi, 'getUsage').mockResolvedValue(MONTH_USAGE)
}

async function mountPage() {
  const wrapper = mount(AiAdminSettings, { attachTo: document.body })
  await flushPromises()
  return wrapper
}

function clickButton(text: string) {
  const button = [...document.body.querySelectorAll('button')].find((element) => element.textContent?.trim() === text)
  if (!button) throw new Error(`No button "${text}"`)
  button.click()
}

describe('AiAdminSettings', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('offers to add a provider when there is none, as the first setup step', async () => {
    stubApi({ overview: { ...OVERVIEW, month: { ...OVERVIEW.month, requests: 0, costMicros: 0 } } })
    const wrapper = await mountPage()
    const empty = wrapper.find('[data-testid="ai-connections-empty"]')
    expect(empty.text()).toContain('No AI provider yet')
    expect(empty.find('[data-preset="anthropic"]').text()).toBe('Anthropic')
    expect(empty.find('[data-preset="other"]').text()).toBe('Other')
    expect(wrapper.find('[data-testid="ai-setup"] [aria-current="step"]').attributes('data-step')).toBe('provider')
  })

  it('shows each provider with its host, masked key, status and month', async () => {
    stubApi({
      connections: [
        connection(),
        connection({
          id: 2,
          name: 'Local',
          baseUrl: 'http://localhost:11434/v1',
          hasKey: false,
          keyHint: null,
          month: { requests: 0, costMicros: 0 },
        }),
      ],
    })
    const wrapper = await mountPage()
    const cards = wrapper.findAll('[data-connection-id]')
    expect(cards).toHaveLength(2)
    expect(cards[0]!.text()).toContain('openrouter.ai')
    expect(cards[0]!.find('[data-testid="ai-connection-key"]').text()).toBe('••••3f9a')
    expect(cards[0]!.text()).toContain('Not tested')
    expect(cards[0]!.find('[data-testid="ai-connection-month"]').text()).toContain('12 requests')
    expect(cards[0]!.find('[data-testid="ai-connection-month"]').text()).toContain('$0.42')
    expect(cards[1]!.find('[data-testid="ai-connection-key"]').text()).toBe('No key')
  })

  it('shows why a provider is failing, in plain words and the provider own', async () => {
    stubApi({
      connections: [
        connection({
          status: 'failing',
          failingSince: '2026-11-09T09:00:00.000Z',
          failingCode: 'out-of-credit',
          failingReason: 'Insufficient credits',
        }),
      ],
      overview: {
        ...OVERVIEW,
        failingConnections: [
          { id: 1, name: 'Router', failingSince: '2026-11-09T09:00:00.000Z', code: 'out-of-credit', reason: 'Insufficient credits' },
        ],
      },
    })
    const wrapper = await mountPage()
    const failure = wrapper.find('[data-testid="ai-connection-failure"]').text()
    expect(failure).toContain('The provider account is out of credit.')
    expect(failure).toContain('Insufficient credits')
    expect(wrapper.find('[data-testid="ai-status-connection-failing"]').text()).toContain('Router started failing')
  })

  it('keeps the providers usable when the overview fails to load', async () => {
    stubApi({ connections: [connection()], overview: new Error('boom') })
    const wrapper = await mountPage()
    expect(wrapper.text()).toContain("Couldn't load this month's AI usage.")
    expect(wrapper.findAll('[data-connection-id]')).toHaveLength(1)
  })

  it('warns when the server cannot store keys', async () => {
    stubApi({ overview: { ...OVERVIEW, encryptionConfigured: false } })
    const wrapper = await mountPage()
    expect(wrapper.find('[data-testid="ai-encryption-missing"]').text()).toContain('AI_ENCRYPTION_KEY')
  })

  it('names the slot that holds a provider instead of trying to delete it', async () => {
    stubApi({ connections: [connection()], settings: settings(1) })
    const remove = vi.spyOn(aiApi, 'deleteConnection').mockResolvedValue()
    const wrapper = await mountPage()
    await wrapper.find('[aria-label="Delete Router"]').trigger('click')
    await flushPromises()

    expect(remove).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Router is in use')
    expect(document.body.textContent).toContain('The Fast slot uses this provider.')
  })

  it('deletes a free provider after confirming', async () => {
    stubApi({ connections: [connection()] })
    const remove = vi.spyOn(aiApi, 'deleteConnection').mockResolvedValue()
    const wrapper = await mountPage()
    await wrapper.find('[aria-label="Delete Router"]').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('Delete Router?')
    clickButton('Delete')
    await flushPromises()

    expect(remove).toHaveBeenCalledWith(1)
    expect(wrapper.findAll('[data-connection-id]')).toHaveLength(0)
  })

  it('says how many unfinished builds hold a provider the server refused to delete', async () => {
    stubApi({ connections: [connection()] })
    vi.spyOn(aiApi, 'deleteConnection').mockRejectedValue(
      new ApiError('2 unfinished builds are using this connection.', 409, 'AI_CONNECTION_IN_USE', null, { slots: '', unfinishedJobs: 2 }),
    )
    const wrapper = await mountPage()
    await wrapper.find('[aria-label="Delete Router"]').trigger('click')
    await flushPromises()
    clickButton('Delete')
    await flushPromises()

    expect(document.body.textContent).toContain('2 unfinished builds are using this connection.')
    expect(wrapper.findAll('[data-connection-id]')).toHaveLength(1)
  })

  it('takes the admin to the slot that holds a provider, with its editor open', async () => {
    stubApi({ connections: [connection()], settings: settings(1) })
    const scroll = vi.fn<typeof Element.prototype.scrollIntoView>()
    Element.prototype.scrollIntoView = scroll
    const wrapper = await mountPage()
    await wrapper.find('[aria-label="Delete Router"]').trigger('click')
    await flushPromises()
    const dialog = document.body.querySelector('[role="dialog"]')!
    ;[...dialog.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Go to models')!.click()
    await flushPromises()

    expect(document.body.textContent).not.toContain('Router is in use')
    expect(scroll).toHaveBeenCalled()
    expect(scroll.mock.contexts[0]).toBe(document.getElementById('ai-slot-fast'))
    expect(wrapper.find('[data-slot="fast"] [data-testid="ai-slot-editor"]').exists()).toBe(true)
  })

  it('lays out the models, features and spending sections from the saved settings', async () => {
    stubApi({ connections: [connection()], settings: settings(1) })
    const wrapper = await mountPage()

    expect(wrapper.find('[data-testid="ai-slot-editor"]').exists()).toBe(false)
    await wrapper.find('[data-slot="fast"] [data-testid="ai-slot-toggle"]').trigger('click')
    const fast = wrapper.find('[data-slot="fast"]')
    expect((fast.find('[data-testid="ai-slot-connection"]').element as HTMLSelectElement).value).toBe('1')
    expect((fast.find('[data-testid="ai-slot-model"]').element as HTMLInputElement).value).toBe('model-a')
    expect(aiApi.listModels).toHaveBeenCalledWith(1)
    expect(wrapper.find('[data-testid="ai-models-measured"]').text()).toContain('GPT-6 Luna')
    expect(wrapper.find('[data-testid="ai-feature-status"]').text()).toContain("Can't build until the Fast and Careful slots have models.")
    expect(wrapper.find('[data-feature="story-guides"] [data-testid="ai-feature-month"]').text()).toContain('$0.30')
    expect(wrapper.find('[data-testid="ai-spending"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ai-spending-checks"]').text()).toBe(
      'Provider tests and Try it cost $0.03 this month, counted in the server total.',
    )
  })

  it('keeps several editors open at once, so a draft is not lost', async () => {
    stubApi({ connections: [connection()], settings: settings(1) })
    const wrapper = await mountPage()
    await wrapper.find('[data-slot="fast"] [data-testid="ai-slot-toggle"]').trigger('click')
    await wrapper.find('[data-feature="story-guides"] [data-testid="ai-feature-toggle"]').trigger('click')
    expect(wrapper.find('[data-slot="fast"] [data-testid="ai-slot-editor"]').exists()).toBe(true)
    expect(wrapper.find('[data-feature="story-guides"] [data-testid="ai-feature-editor"]').exists()).toBe(true)
  })

  it('saves the server limit from Spending', async () => {
    stubApi({ connections: [connection()], settings: settings(1) })
    const save = vi.spyOn(aiApi, 'updateBudget').mockResolvedValue({ ...settings(1), budget: { monthlyBudget: 25, buildsPerMonth: null } })
    const wrapper = await mountPage()
    const server = wrapper.find('[data-spend="server"]')
    expect(server.find('[data-testid="ai-spend-limit"]').text()).toBe('No limit')
    await server.find('[data-testid="ai-spend-toggle"]').trigger('click')
    await server.find('[data-testid="ai-spend-monthlyBudget"]').setValue('25')
    await server.find('[data-testid="ai-spend-save"]').trigger('click')
    await flushPromises()

    expect(save).toHaveBeenCalledWith({ monthlyBudget: 25 })
    expect(wrapper.find('[data-spend="server"] [data-testid="ai-spend-editor"]').exists()).toBe(false)
    expect(wrapper.find('[data-spend="server"] [data-testid="ai-spend-limit"]').text()).toBe('$25.00')
  })

  it('saves a feature limit and its builds a month from Spending', async () => {
    stubApi({ connections: [connection()], settings: settings(1) })
    const save = vi.spyOn(aiApi, 'updateFeature').mockResolvedValue(settings(1))
    const wrapper = await mountPage()
    const guides = wrapper.find('[data-spend="story-guides"]')
    await guides.find('[data-testid="ai-spend-toggle"]').trigger('click')
    await guides.find('[data-testid="ai-spend-monthlyBudget"]').setValue('10')
    await guides.find('[data-testid="ai-spend-buildsPerMonth"]').setValue('40')
    await guides.find('[data-testid="ai-spend-save"]').trigger('click')
    await flushPromises()

    expect(save).toHaveBeenCalledWith('story-guides', { monthlyBudget: 10, buildsPerMonth: 40 })
  })

  it('opens the server limit from the status strip when the month is nearly spent', async () => {
    stubApi({
      connections: [connection()],
      settings: { ...settings(1), budget: { monthlyBudget: 1, buildsPerMonth: null } },
      overview: { ...OVERVIEW, budget: { ...OVERVIEW.budget, monthlyBudget: 1, used: 0.84, warning: true } },
    })
    Element.prototype.scrollIntoView = vi.fn<typeof Element.prototype.scrollIntoView>()
    const wrapper = await mountPage()
    expect(wrapper.find('[data-testid="ai-status-budget"]').text()).toContain('84%')
    clickButton('Raise limit')
    await flushPromises()
    expect(wrapper.find('[data-spend="server"] [data-testid="ai-spend-editor"]').exists()).toBe(true)
  })

  it('opens the usage view from the overview and comes back', async () => {
    stubApi({ connections: [connection()] })
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    const wrapper = await mountPage()
    clickButton('View usage')
    await flushPromises()

    expect(aiApi.getUsage).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid="ai-usage"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ai-connections"]').exists()).toBe(false)

    await wrapper.find('[data-testid="ai-usage-back"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="ai-connections"]').exists()).toBe(true)
  })

  it('tests a saved provider and reloads its row', async () => {
    stubApi({ connections: [connection()] })
    const test = vi.spyOn(aiApi, 'testSavedConnection').mockResolvedValue({
      at: '2026-11-09T10:00:00.000Z',
      ok: true,
      host: 'openrouter.ai',
      model: 'model-a',
      steps: [],
      jsonSupport: 'schema',
      modelCount: 3,
      models: null,
    })
    const wrapper = await mountPage()
    await wrapper.find('[aria-label="Test Router"]').trigger('click')
    await flushPromises()

    expect(test).toHaveBeenCalledWith(1)
    expect(aiApi.listConnections).toHaveBeenCalledTimes(2)
    expect(wrapper.findAll('[data-connection-id]')).toHaveLength(1)
  })
})
