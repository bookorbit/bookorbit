import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiConnection, AiOverview, AiSettings, AiSlotSettings } from '@bookorbit/types'

import { ApiError } from '@/lib/api-json'
import * as aiApi from './api/ai.api'
import AiAdminSettings from './AiAdminSettings.vue'

const EMPTY_SLOT: AiSlotSettings = { connectionId: null, model: null, prices: null, jsonMode: 'auto', maxOutputTokens: null }

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

function stubApi(options: { connections?: AiConnection[]; overview?: AiOverview | Error; settings?: AiSettings } = {}) {
  const overview = options.overview ?? OVERVIEW
  vi.spyOn(aiApi, 'getOverview').mockImplementation(() => (overview instanceof Error ? Promise.reject(overview) : Promise.resolve(overview)))
  vi.spyOn(aiApi, 'listConnections').mockResolvedValue(options.connections ?? [])
  vi.spyOn(aiApi, 'getSettings').mockResolvedValue(options.settings ?? settings())
  vi.spyOn(aiApi, 'listModels').mockResolvedValue({ listed: true, models: [{ id: 'model-a' }] })
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

  it('offers to add a provider when there is none', async () => {
    stubApi()
    const wrapper = await mountPage()
    const empty = wrapper.find('[data-testid="ai-connections-empty"]')
    expect(empty.text()).toContain('No AI provider yet')
    expect(empty.text()).toContain('Add provider')
  })

  it('shows each connection with its host, masked key, status and month', async () => {
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
    expect(cards[0]!.text()).toContain('12 requests this month, $0.42')
    expect(cards[1]!.find('[data-testid="ai-connection-key"]').text()).toBe('No key')
  })

  it('shows why a connection is failing, in plain words and the provider own', async () => {
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
    expect(failure).toContain('The provider said: Insufficient credits')
    expect(wrapper.find('[data-testid="ai-overview-failing"]').text()).toContain('Router failing since')
  })

  it('keeps the connections usable when the overview fails to load', async () => {
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

  it('names the slot that holds a connection instead of trying to delete it', async () => {
    stubApi({ connections: [connection()], settings: settings(1) })
    const remove = vi.spyOn(aiApi, 'deleteConnection').mockResolvedValue()
    const wrapper = await mountPage()
    await wrapper.find('[aria-label="Delete Router"]').trigger('click')
    await flushPromises()

    expect(remove).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Router is in use')
    expect(document.body.textContent).toContain('The Fast slot uses this connection.')
  })

  it('deletes a free connection after confirming', async () => {
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

  it('says how many unfinished builds hold a connection the server refused to delete', async () => {
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

  it('takes the admin to the slot that holds a connection', async () => {
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
  })

  it('lays out the models, features and budget sections from the saved settings', async () => {
    stubApi({ connections: [connection()], settings: settings(1) })
    const wrapper = await mountPage()

    const fast = wrapper.find('[data-slot="fast"]')
    expect((fast.find('[data-testid="ai-slot-connection"]').element as HTMLSelectElement).value).toBe('1')
    expect((fast.find('[data-testid="ai-slot-model"]').element as HTMLInputElement).value).toBe('model-a')
    expect(aiApi.listModels).toHaveBeenCalledWith(1)
    expect(wrapper.find('[data-testid="ai-models-measured"]').text()).toContain('GPT-6 Luna')
    expect(wrapper.find('[data-testid="ai-feature-status"]').text()).toContain("Can't build until the Fast and Careful slots have models.")
    expect(wrapper.find('[data-testid="ai-budget"]').exists()).toBe(true)
  })

  it('opens the usage view from the overview and comes back', async () => {
    stubApi({ connections: [connection()] })
    const usage = vi.spyOn(aiApi, 'getUsage').mockResolvedValue({
      from: '2025-12',
      to: '2026-11',
      months: [],
      byFeature: [],
      byModel: [],
      costliestJobs: [],
      recentErrors: [],
    })
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    const wrapper = await mountPage()
    clickButton('View usage')
    await flushPromises()

    expect(usage).toHaveBeenCalled()
    expect(wrapper.find('[data-testid="ai-usage"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ai-connections"]').exists()).toBe(false)

    await wrapper.find('[data-testid="ai-usage-back"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="ai-connections"]').exists()).toBe(true)
  })

  it('tests a saved connection and reloads its card', async () => {
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
    clickButton('Test')
    await flushPromises()

    expect(test).toHaveBeenCalledWith(1)
    expect(aiApi.listConnections).toHaveBeenCalledTimes(2)
    expect(wrapper.findAll('[data-connection-id]')).toHaveLength(1)
  })
})
