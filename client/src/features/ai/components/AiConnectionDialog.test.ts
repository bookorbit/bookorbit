import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiConnection, AiConnectionTestResult } from '@bookorbit/types'

import * as aiApi from '../api/ai.api'
import AiConnectionDialog from './AiConnectionDialog.vue'

const PASSED: AiConnectionTestResult = {
  at: '2026-11-09T10:00:00.000Z',
  ok: true,
  host: 'localhost:11434',
  model: 'llama3.1',
  steps: [
    { id: 'reach', ok: true, durationMs: 42 },
    { id: 'key', ok: true },
    { id: 'models', ok: true, modelCount: 2 },
    { id: 'json', ok: true, jsonSupport: 'schema' },
    { id: 'usage', ok: true },
    { id: 'image', ok: false, code: 'no-image-input', message: 'This model does not support image input' },
  ],
  jsonSupport: 'schema',
  modelCount: 2,
  models: { listed: true, models: [{ id: 'llama3.1' }, { id: 'qwen3' }] },
}

const FAILED: AiConnectionTestResult = {
  ...PASSED,
  ok: false,
  steps: [
    { id: 'reach', ok: true, durationMs: 42 },
    { id: 'key', ok: false, code: 'key-rejected', message: 'Incorrect API key provided' },
    { id: 'models', ok: null },
    { id: 'json', ok: null },
    { id: 'usage', ok: null },
    { id: 'image', ok: null },
  ],
  models: null,
}

const SAVED: AiConnection = {
  id: 7,
  name: 'Home box',
  apiType: 'openai-chat',
  usable: true,
  baseUrl: 'http://localhost:11434/v1',
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
}

function mountDialog(props: Record<string, unknown> = {}) {
  return mount(AiConnectionDialog, { props: { open: true, connection: null, ...props }, attachTo: document.body })
}

function dialog(): HTMLElement {
  return document.body.querySelector<HTMLElement>('[data-testid="ai-connection-dialog"]')!
}

function field(label: string): HTMLInputElement | HTMLSelectElement {
  const labelElement = [...dialog().querySelectorAll('label')].find((element) => element.textContent?.trim().startsWith(label))
  return dialog().querySelector<HTMLInputElement | HTMLSelectElement>(`#${CSS.escape(labelElement!.htmlFor)}`)!
}

async function type(element: HTMLInputElement | HTMLSelectElement, value: string) {
  element.value = value
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input'))
  await flushPromises()
}

async function submit() {
  dialog().querySelector('form')!.dispatchEvent(new Event('submit'))
  await flushPromises()
}

function clickButton(text: string) {
  const button = [...document.body.querySelectorAll('button')].find((element) => element.textContent?.trim() === text)
  if (!button) throw new Error(`No button "${text}"`)
  button.click()
}

describe('AiConnectionDialog', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('fills the details from the chosen preset and shows its warning', async () => {
    mountDialog()
    await flushPromises()
    dialog().querySelector<HTMLButtonElement>('[data-preset="openrouter"]')!.click()
    await flushPromises()

    expect((field('Name') as HTMLInputElement).value).toBe('OpenRouter')
    expect((field('Base URL') as HTMLInputElement).value).toBe('https://openrouter.ai/api/v1')
    expect(dialog().textContent).toContain('Calls https://openrouter.ai/api/v1/chat/completions')
    expect(dialog().querySelector('[data-testid="ai-preset-warning"]')?.textContent).toContain('OpenRouter')
    expect(dialog().querySelectorAll('[data-testid="ai-header-row"]')).toHaveLength(2)
  })

  it('picks the API type from a pasted URL', async () => {
    mountDialog()
    await flushPromises()
    await type(field('Or paste a URL') as HTMLInputElement, 'https://api.anthropic.com/v1/messages')
    clickButton('Use URL')
    await flushPromises()

    expect((field('API type') as HTMLSelectElement).value).toBe('anthropic-messages')
    expect((field('Base URL') as HTMLInputElement).value).toBe('https://api.anthropic.com')
  })

  it('tests on entering the last step, and saves a passing connection', async () => {
    const test = vi.spyOn(aiApi, 'testDraftConnection').mockResolvedValue(PASSED)
    const create = vi.spyOn(aiApi, 'createConnection').mockResolvedValue({ ...SAVED, id: 9, name: 'Ollama' })
    const wrapper = mountDialog()
    await flushPromises()
    dialog().querySelector<HTMLButtonElement>('[data-preset="ollama"]')!.click()
    await flushPromises()
    await submit()

    expect(test).toHaveBeenCalledWith(expect.objectContaining({ name: 'Ollama', baseUrl: 'http://localhost:11434/v1', apiType: 'openai-chat' }))
    const rows = [...dialog().querySelectorAll('[data-step]')].map((row) => [row.getAttribute('data-step'), row.getAttribute('data-state')])
    expect(rows).toEqual([
      ['reach', 'pass'],
      ['key', 'pass'],
      ['models', 'pass'],
      ['json', 'pass'],
      ['usage', 'pass'],
      ['image', 'limited'],
    ])
    expect(dialog().textContent).toContain('Reached localhost:11434 in 42 ms')
    expect(dialog().textContent).toContain("This model can't read pictures. Photo scans need one that can; story guides don't.")
    expect(dialog().textContent).toContain('Answered in JSON: JSON schema enforced')

    await submit()
    expect(create).toHaveBeenCalledOnce()
    expect(wrapper.emitted('saved')?.[0]).toEqual([{ ...SAVED, id: 9, name: 'Ollama' }, true])
  })

  it('says what failed in plain words, and asks before saving anyway', async () => {
    vi.spyOn(aiApi, 'testDraftConnection').mockResolvedValue(FAILED)
    const create = vi.spyOn(aiApi, 'createConnection').mockResolvedValue(SAVED)
    const wrapper = mountDialog()
    await flushPromises()
    dialog().querySelector<HTMLButtonElement>('[data-preset="cliproxyapi"]')!.click()
    await flushPromises()
    await submit()

    const key = dialog().querySelector('[data-step="key"]')!
    expect(key.getAttribute('data-state')).toBe('fail')
    expect(key.textContent).toContain('The provider rejected the key. Check the key.')
    expect(key.textContent).toContain('Incorrect API key provided')
    expect(dialog().querySelector('[data-step="models"]')!.getAttribute('data-state')).toBe('skipped')

    await submit()
    expect(create).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Save without a passing test?')
    clickButton('Save anyway')
    await flushPromises()
    expect(create).toHaveBeenCalledOnce()
    expect(wrapper.emitted('saved')?.[0]?.[1]).toBe(false)
  })

  it('keeps a reserved header out before testing', async () => {
    const test = vi.spyOn(aiApi, 'testDraftConnection').mockResolvedValue(PASSED)
    mountDialog()
    await flushPromises()
    dialog().querySelector<HTMLButtonElement>('[data-preset="vllm"]')!.click()
    await flushPromises()
    clickButton('Add header')
    await flushPromises()
    const [name, value] = [...dialog().querySelectorAll<HTMLInputElement>('[data-testid="ai-header-row"] input')]
    await type(name!, 'Authorization')
    await type(value!, 'Bearer nope')
    await submit()

    expect(test).not.toHaveBeenCalled()
    expect(dialog().textContent).toContain('Authorization is set by the API type')
  })

  it('opens an edit on the details, and removes the saved key only when asked', async () => {
    vi.spyOn(aiApi, 'testDraftConnection').mockResolvedValue(PASSED)
    const update = vi.spyOn(aiApi, 'updateConnection').mockResolvedValue(SAVED)
    mountDialog({ connection: SAVED, slotModel: 'qwen3' })
    await flushPromises()

    expect((field('Name') as HTMLInputElement).value).toBe('Home box')
    expect(dialog().textContent).toContain('Saved key ••••3f9a')
    clickButton('Remove key')
    await flushPromises()
    expect(dialog().querySelector('[data-testid="ai-key-removed"]')).not.toBeNull()

    await submit()
    expect(aiApi.testDraftConnection).toHaveBeenCalledWith(expect.objectContaining({ connectionId: 7, model: 'qwen3', key: null }))
    await submit()
    expect(update).toHaveBeenCalledWith(7, expect.objectContaining({ key: null, name: 'Home box' }))
  })
})
