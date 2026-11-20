import { describe, expect, it } from 'vitest'
import type { AiConnection } from '@bookorbit/types'

import {
  createRequest,
  draftFromConnection,
  draftFromPreset,
  draftFromUrl,
  normalisedBaseUrl,
  testRequest,
  updateRequest,
  validateDraft,
} from './ai-connection-draft'

const SAVED: AiConnection = {
  id: 4,
  name: 'Router',
  apiType: 'openai-chat',
  usable: true,
  baseUrl: 'https://openrouter.ai/api/v1',
  hasKey: true,
  keyHint: '3f9a',
  headers: [{ name: 'X-Title', hasValue: true, valueHint: 'rbit' }],
  networkProfile: { proxyUrl: 'http://proxy.local:8080' },
  timeoutMs: 90_000,
  maxParallel: 4,
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

describe('connection drafts', () => {
  it('fills the details from a preset, attribution headers included', () => {
    const draft = draftFromPreset('openrouter')
    expect(draft).toMatchObject({
      name: 'OpenRouter',
      apiType: 'openai-chat',
      baseUrl: 'https://openrouter.ai/api/v1',
      timeoutSeconds: '120',
      maxParallel: '8',
    })
    expect(draft.headers.map((header) => header.name)).toEqual(['HTTP-Referer', 'X-Title'])
    expect(draftFromPreset('other').name).toBe('')
  })

  it('picks the preset and API type from a pasted URL', () => {
    expect(draftFromUrl('https://api.anthropic.com/v1/messages')).toMatchObject({
      presetId: 'anthropic',
      apiType: 'anthropic-messages',
      baseUrl: 'https://api.anthropic.com',
    })
    expect(draftFromUrl('http://localhost:11434')).toMatchObject({ presetId: 'ollama', baseUrl: 'http://localhost:11434/v1' })
    expect(draftFromUrl('not a url')).toBeNull()
  })

  it('shows where requests will go as the URL is typed', () => {
    const draft = { ...draftFromPreset('other'), baseUrl: 'http://box.lan:8000' }
    expect(normalisedBaseUrl(draft)).toBe('http://box.lan:8000/v1')
  })

  it('refuses a header the API type sets itself, a header without a value, and numbers out of range', () => {
    const draft = draftFromPreset('other')
    draft.name = 'Box'
    draft.baseUrl = 'http://box.lan:8000/v1'
    draft.headers = [{ name: 'Authorization', value: 'Bearer x', storedHint: null }]
    expect(validateDraft(draft, false).headers).toMatchObject({
      key: 'settings.admin.ai.sheet.errors.headerReserved',
      params: { name: 'Authorization' },
    })

    draft.headers = [{ name: 'api-key', value: '', storedHint: null }]
    expect(validateDraft(draft, false).headers?.key).toBe('settings.admin.ai.sheet.errors.headerValueRequired')

    draft.headers = []
    draft.timeoutSeconds = '5'
    draft.maxParallel = '40'
    draft.requestsPerMinute = 'lots'
    expect(Object.keys(validateDraft(draft, false)).sort()).toEqual(['maxParallel', 'requestsPerMinute', 'timeoutSeconds'])
  })

  it('needs the key only where the provider takes one', () => {
    const draft = draftFromPreset('openai')
    expect(validateDraft(draft, true).key).toBeDefined()
    expect(validateDraft({ ...draft, key: 'sk-test' }, true).key).toBeUndefined()
  })

  it('creates with what was typed, leaving out what is empty', () => {
    const draft = draftFromPreset('ollama')
    draft.requestsPerMinute = '30'
    expect(createRequest(draft)).toEqual({
      name: 'Ollama',
      apiType: 'openai-chat',
      baseUrl: 'http://localhost:11434/v1',
      headers: [],
      networkProfile: null,
      timeoutMs: 120_000,
      maxParallel: 8,
      requestsPerMinute: 30,
    })
  })

  it('keeps a saved key and header value unless they are typed again or removed', () => {
    const draft = draftFromConnection(SAVED)
    expect(draft).toMatchObject({ timeoutSeconds: '90', maxParallel: '4', requestsPerMinute: '', proxyUrl: 'http://proxy.local:8080' })
    expect(draft.headers).toEqual([{ name: 'X-Title', value: '', storedHint: 'rbit' }])
    expect(validateDraft(draft, false)).toEqual({})

    const untouched = updateRequest(draft)
    expect(untouched).not.toHaveProperty('key')
    expect(untouched.headers).toEqual([{ name: 'X-Title' }])
    expect(untouched.networkProfile).toEqual({ proxyUrl: 'http://proxy.local:8080' })

    expect(updateRequest({ ...draft, key: ' sk-new ' }).key).toBe('sk-new')
    expect(updateRequest({ ...draft, removeKey: true, key: 'ignored' }).key).toBeNull()
  })

  it('tests an edit against the saved connection, with the chosen model', () => {
    const draft = draftFromConnection(SAVED)
    expect(testRequest(draft, 4, 'model-a')).toMatchObject({ connectionId: 4, model: 'model-a' })
    expect(testRequest(draft, null, null)).not.toHaveProperty('connectionId')
  })
})
