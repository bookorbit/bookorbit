import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import type { AiConnection, AiModelList, AiSlotSettings, AiTryResult } from '@bookorbit/types'

import AiSlotRow from './AiSlotRow.vue'

const EMPTY: AiSlotSettings = { connectionId: null, model: null, prices: null, jsonMode: 'auto', maxOutputTokens: null, effort: 'auto' }

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
    status: 'working',
    lastTest: null,
    failingSince: null,
    failingCode: null,
    failingReason: null,
    month: { requests: 0, costMicros: 0 },
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  }
}

const LIST: AiModelList = {
  listed: true,
  models: [
    {
      id: 'vendor/fast-model',
      name: 'Fast model',
      contextLength: 128_000,
      maxOutputTokens: 16_000,
      prices: { input: 0.1, output: 0.5 },
      efforts: ['low', 'medium', 'high'],
      defaultEffort: 'medium',
    },
    { id: 'vendor/plain-model' },
    { id: 'vendor/quiet-model', efforts: [] },
  ],
}

function mountRow(props: Partial<InstanceType<typeof AiSlotRow>['$props']> = {}) {
  return mount(AiSlotRow, {
    attachTo: document.body,
    props: {
      slotId: 'fast',
      value: EMPTY,
      connections: [connection()],
      modelLists: { 1: LIST },
      usedBy: [{ id: 'story-guides', optional: false }],
      open: true,
      saving: false,
      trying: false,
      tryResult: null,
      tryError: null,
      ...props,
    },
  })
}

describe('AiSlotRow', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('fills the prices and output limit from the model list and saves the slot', async () => {
    const wrapper = mountRow()
    await wrapper.find('[data-testid="ai-slot-connection"]').setValue('1')
    expect(wrapper.emitted('needModels')?.[0]).toEqual([1, false])
    await wrapper.find('[data-testid="ai-slot-model"]').setValue('vendor/fast-model')

    expect((wrapper.find('[data-testid="ai-slot-price-input"]').element as HTMLInputElement).value).toBe('0.1')
    expect((wrapper.find('[data-testid="ai-slot-price-output"]').element as HTMLInputElement).value).toBe('0.5')
    expect(wrapper.find('[data-testid="ai-slot-facts"]').text()).toBe(
      "From Router's model list: 128K context, $0.10 in and $0.50 out per million tokens.",
    )
    expect(wrapper.findAll('datalist option')).toHaveLength(3)

    await wrapper.find('[data-testid="ai-slot-save"]').trigger('click')
    expect(wrapper.emitted('save')?.[0]).toEqual([
      { connectionId: 1, model: 'vendor/fast-model', prices: { input: 0.1, output: 0.5 }, jsonMode: 'auto', maxOutputTokens: 16_000, effort: 'auto' },
    ])
  })

  it('keeps prices typed by hand for the saved model when the list arrives', () => {
    const wrapper = mountRow({ value: { ...EMPTY, connectionId: 1, model: 'vendor/fast-model', prices: { input: 2, output: 8 } } })
    expect((wrapper.find('[data-testid="ai-slot-price-input"]').element as HTMLInputElement).value).toBe('2')
    expect((wrapper.find('[data-testid="ai-slot-save"]').element as HTMLButtonElement).disabled).toBe(true)
  })

  it('asks for a model with the provider, and for both prices or neither', async () => {
    const wrapper = mountRow()
    await wrapper.find('[data-testid="ai-slot-connection"]').setValue('1')
    expect(wrapper.text()).toContain('Choose a provider and a model, or neither.')
    expect((wrapper.find('[data-testid="ai-slot-save"]').element as HTMLButtonElement).disabled).toBe(true)

    await wrapper.find('[data-testid="ai-slot-model"]').setValue('vendor/plain-model')
    await wrapper.find('[data-testid="ai-slot-price-input"]').setValue('3')
    expect(wrapper.text()).toContain('Enter both prices as numbers, or leave both empty.')
    expect((wrapper.find('[data-testid="ai-slot-save"]').element as HTMLButtonElement).disabled).toBe(true)
  })

  it('empties the slot when the provider is set to none', async () => {
    const wrapper = mountRow({ value: { ...EMPTY, connectionId: 1, model: 'vendor/plain-model', maxOutputTokens: 4000 } })
    await wrapper.find('[data-testid="ai-slot-connection"]').setValue('')
    await wrapper.find('[data-testid="ai-slot-save"]').trigger('click')
    expect(wrapper.emitted('save')?.[0]).toEqual([
      { connectionId: null, model: null, prices: null, jsonMode: 'auto', maxOutputTokens: null, effort: 'auto' },
    ])
  })

  it('offers the levels a model lists, and every level where its provider does not say', async () => {
    const wrapper = mountRow({ value: { ...EMPTY, connectionId: 1, model: 'vendor/fast-model' } })
    const levels = () => wrapper.findAll('[data-testid="ai-slot-effort"] option').map((option) => option.attributes('value'))
    expect(levels()).toEqual(['auto', 'low', 'medium', 'high'])
    expect(wrapper.text()).toContain('It uses Medium when none is sent.')

    await wrapper.find('[data-testid="ai-slot-model"]').setValue('vendor/plain-model')
    expect(levels()).toEqual(['auto', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
    expect(wrapper.text()).toContain("This provider doesn't list which levels its models take")

    await wrapper.find('[data-testid="ai-slot-model"]').setValue('vendor/quiet-model')
    expect(levels()).toEqual(['auto'])
    expect(wrapper.text()).toContain('This model takes no effort level.')
  })

  it('opens Advanced on a saved level, saves a new one, and goes back to Automatic for a model without it', async () => {
    const wrapper = mountRow({ value: { ...EMPTY, connectionId: 1, model: 'vendor/plain-model', effort: 'xhigh' } })
    expect(wrapper.find('details').attributes('open')).toBeDefined()
    const effort = wrapper.find('[data-testid="ai-slot-effort"]')
    expect((effort.element as HTMLSelectElement).value).toBe('xhigh')

    await effort.setValue('max')
    await wrapper.find('[data-testid="ai-slot-save"]').trigger('click')
    expect(wrapper.emitted('save')?.[0]?.[0]).toMatchObject({ model: 'vendor/plain-model', effort: 'max' })

    await wrapper.find('[data-testid="ai-slot-model"]').setValue('vendor/fast-model')
    expect((effort.element as HTMLSelectElement).value).toBe('auto')
  })

  it('keeps Advanced closed on Automatic', () => {
    const wrapper = mountRow({ value: { ...EMPTY, connectionId: 1, model: 'vendor/plain-model' } })
    expect(wrapper.find('details').attributes('open')).toBeUndefined()
  })

  it('shows what Try it found, how long it took and what it cost', () => {
    const result: AiTryResult = {
      slot: 'fast',
      model: 'vendor/fast-model',
      names: [
        { name: 'Elizabeth Bennet', kind: 'person', description: 'Second daughter of the Bennets.' },
        { name: 'Netherfield Park', kind: 'place', description: 'The estate let to Mr. Bingley.' },
      ],
      durationMs: 2400,
      usage: { input: 900, output: 120 },
      costMicros: 150,
      jsonSupport: 'schema',
    }
    const wrapper = mountRow({ value: { ...EMPTY, connectionId: 1, model: 'vendor/fast-model' }, tryResult: result })
    expect(wrapper.find('[data-testid="ai-try-line"]').text()).toBe('vendor/fast-model found 2 names in 2.4 s, $0.0002.')
    const panel = wrapper.find('[data-testid="ai-try-result"]').text()
    expect(panel).toContain('Elizabeth Bennet')
    expect(panel).toContain('Person')
    expect(panel).toContain('Answer format: JSON schema enforced')
  })

  it('lists the books the Vision slot read in the sample picture', () => {
    const result: AiTryResult = {
      slot: 'vision',
      model: 'vendor/vision-model',
      names: [],
      books: [
        { title: 'Pride and Prejudice', author: 'Jane Austen' },
        { title: 'Dracula', author: null },
      ],
      durationMs: 800,
      usage: { input: 400, output: 60 },
      costMicros: null,
      jsonSupport: 'schema',
    }
    const wrapper = mountRow({ slotId: 'vision', value: { ...EMPTY, connectionId: 1, model: 'vendor/vision-model' }, tryResult: result })
    expect(wrapper.text()).toContain('Vision')
    const panel = wrapper.find('[data-testid="ai-try-books"]').text()
    expect(wrapper.find('[data-testid="ai-try-line"]').text()).toBe('vendor/vision-model read 2 books in 800 ms, cost unknown.')
    expect(panel).toContain('Pride and Prejudice')
    expect(panel).toContain('Jane Austen')
    expect(panel).toContain('Dracula')
  })

  it('shows why Try it failed with the provider own words', () => {
    const wrapper = mountRow({
      value: { ...EMPTY, connectionId: 1, model: 'vendor/fast-model' },
      tryError: { text: 'The provider account is out of credit.', providerMessage: 'Insufficient credits' },
    })
    const error = wrapper.find('[data-testid="ai-try-error"]').text()
    expect(error).toContain('The provider account is out of credit.')
    expect(error).toContain('Insufficient credits')
  })

  it('offers a Messages provider for Claude on a proxy, and not on Anthropic itself', async () => {
    const proxy = connection({ id: 2, name: 'Proxy', baseUrl: 'http://localhost:8317/v1' })
    const anthropic = connection({ id: 3, name: 'Anthropic', apiType: 'anthropic-messages', baseUrl: 'https://api.anthropic.com' })
    const wrapper = mountRow({ connections: [proxy, anthropic], modelLists: { 2: { listed: false, models: [] }, 3: { listed: false, models: [] } } })

    await wrapper.find('[data-testid="ai-slot-connection"]').setValue('2')
    await wrapper.find('[data-testid="ai-slot-model"]').setValue('claude-sonnet-5')
    expect(wrapper.find('[data-testid="ai-anthropic-offer"]').exists()).toBe(true)
    await wrapper.find('[data-testid="ai-anthropic-offer"] button').trigger('click')
    expect(wrapper.emitted('addAnthropic')?.[0]).toEqual([proxy])

    await wrapper.find('[data-testid="ai-slot-connection"]').setValue('3')
    await wrapper.find('[data-testid="ai-slot-model"]').setValue('claude-sonnet-5')
    expect(wrapper.find('[data-testid="ai-anthropic-offer"]').exists()).toBe(false)
  })

  it('saves edits before trying them, so Try it asks about what is shown', async () => {
    const wrapper = mountRow({ value: { ...EMPTY, connectionId: 1, model: 'vendor/plain-model' } })
    const tryButton = () => wrapper.find('[data-testid="ai-slot-try"]')
    expect(tryButton().text()).toBe('Try it')
    await tryButton().trigger('click')
    expect(wrapper.emitted('try')?.[0]).toEqual([null])

    await wrapper.find('[data-testid="ai-slot-model"]').setValue('vendor/fast-model')
    expect(tryButton().text()).toBe('Save and try')
    await tryButton().trigger('click')
    expect(wrapper.emitted('try')?.[1]?.[0]).toMatchObject({ connectionId: 1, model: 'vendor/fast-model' })
  })

  it('has nothing to try for an empty slot', async () => {
    const wrapper = mountRow()
    expect((wrapper.find('[data-testid="ai-slot-try"]').element as HTMLButtonElement).disabled).toBe(true)
    await wrapper.find('[data-testid="ai-slot-connection"]').setValue('1')
    expect((wrapper.find('[data-testid="ai-slot-try"]').element as HTMLButtonElement).disabled).toBe(true)
  })

  it('throws away edits on Cancel and closes the editor', async () => {
    const wrapper = mountRow({ value: { ...EMPTY, connectionId: 1, model: 'vendor/plain-model' } })
    await wrapper.find('[data-testid="ai-slot-model"]').setValue('vendor/fast-model')
    await wrapper.find('[data-testid="ai-slot-cancel"]').trigger('click')
    expect(wrapper.emitted('setOpen')?.[0]).toEqual([false])
    expect((wrapper.find('[data-testid="ai-slot-model"]').element as HTMLInputElement).value).toBe('vendor/plain-model')
  })

  it('sums up a closed slot: who uses it, its model, price and status', async () => {
    const wrapper = mountRow({
      open: false,
      usedBy: [
        { id: 'story-guides', optional: false },
        { id: 'reading-help', optional: true },
      ],
      value: { ...EMPTY, connectionId: 1, model: 'vendor/fast-model', prices: { input: 0.1, output: 0.5 } },
    })
    expect(wrapper.find('[data-testid="ai-slot-editor"]').exists()).toBe(false)
    const text = wrapper.text()
    expect(text).toContain('Story guides')
    expect(text).toContain('Reading help, optional')
    expect(wrapper.find('[data-testid="ai-slot-summary"]').text()).toContain('vendor/fast-model')
    expect(text).toContain('$0.10 / $0.50')
    expect(text).toContain('Working')

    const toggle = wrapper.find('[data-testid="ai-slot-toggle"]')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    await toggle.trigger('click')
    expect(wrapper.emitted('setOpen')?.[0]).toEqual([true])
  })

  it('says why a slot fails and offers another provider', async () => {
    const wrapper = mountRow({
      open: false,
      connections: [connection({ status: 'failing', failingSince: '2026-11-01T00:00:00.000Z', failingCode: 'key-rejected' })],
      value: { ...EMPTY, connectionId: 1, model: 'vendor/fast-model' },
    })
    expect(wrapper.text()).toContain('Provider failing')
    const health = wrapper.find('[data-testid="ai-slot-health"]')
    expect(health.text()).toContain('Router is failing')
    await health.find('button').trigger('click')
    expect(wrapper.emitted('setOpen')?.[0]).toEqual([true])
  })

  it('names an empty slot and asks for a model', () => {
    const wrapper = mountRow({ open: false })
    expect(wrapper.find('[data-testid="ai-slot-summary"]').text()).toContain('Not set')
  })
})
