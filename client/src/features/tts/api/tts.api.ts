import { api } from '@/lib/api'
import type { TtsChapterText, TtsEffectivePreferences, TtsProviderStatus, TtsSynthesisRequest, TtsUserPreferences, TtsVoice } from '@bookorbit/types'
import { toStaticVoiceConfig, type StaticVoiceConfig } from '../lib/voice-presets'

export type { StaticVoiceConfig }

export interface TtsProviderInfo {
  id: string
  name: string
  type: string
}

export interface TtsDbProvider {
  id: number
  name: string
  type: string
  enabled: boolean
  baseUrl: string | null
  apiKey: string | null
  defaultModel: string | null
  displayOrder: number
  staticVoices: StaticVoiceConfig[] | null
  supportsVoiceDiscovery: boolean
}

export interface TtsPosition {
  cfi: string
  chapterIndex: number | null
}

export interface TtsBookPrefs {
  providerId?: string | null
  voiceId?: string | null
  speed?: number | null
}

async function assertOk(res: Response): Promise<void> {
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`TTS API error ${res.status}: ${text}`)
  }
}

// ---- Synthesis ----

export async function synthesize(params: TtsSynthesisRequest): Promise<Response> {
  return api('/api/v1/tts/synthesize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
}

export async function previewVoice(providerId: string, voiceId: string): Promise<Response> {
  return api('/api/v1/tts/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerId, voiceId }),
  })
}

// ---- Voices & Providers ----

export async function getVoices(providerId?: string): Promise<TtsVoice[]> {
  const url = providerId ? `/api/v1/tts/voices?providerId=${encodeURIComponent(providerId)}` : '/api/v1/tts/voices'
  const res = await api(url)
  await assertOk(res)
  return res.json() as Promise<TtsVoice[]>
}

export async function getProviders(): Promise<TtsProviderInfo[]> {
  const res = await api('/api/v1/tts/providers')
  await assertOk(res)
  return res.json() as Promise<TtsProviderInfo[]>
}

// ---- User preferences ----

export async function getPreferences(): Promise<TtsUserPreferences | null> {
  const res = await api('/api/v1/tts/preferences')
  await assertOk(res)
  return res.json() as Promise<TtsUserPreferences | null>
}

export async function savePreferences(prefs: Partial<TtsUserPreferences>): Promise<TtsUserPreferences> {
  const res = await api('/api/v1/tts/preferences', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prefs),
  })
  await assertOk(res)
  return res.json() as Promise<TtsUserPreferences>
}

// ---- Book preferences ----

export async function getBookPreferences(bookId: number): Promise<TtsEffectivePreferences> {
  const res = await api(`/api/v1/tts/preferences/book/${bookId}`)
  await assertOk(res)
  return res.json() as Promise<TtsEffectivePreferences>
}

export async function saveBookPreferences(bookId: number, prefs: TtsBookPrefs): Promise<void> {
  const res = await api(`/api/v1/tts/preferences/book/${bookId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prefs),
  })
  await assertOk(res)
}

export async function deleteBookPreferences(bookId: number): Promise<void> {
  const res = await api(`/api/v1/tts/preferences/book/${bookId}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 204) await assertOk(res)
}

// ---- TTS position ----

export async function getPosition(bookFileId: number): Promise<TtsPosition | null> {
  const res = await api(`/api/v1/tts/position/${bookFileId}`)
  await assertOk(res)
  return res.json() as Promise<TtsPosition | null>
}

export async function savePosition(bookFileId: number, pos: TtsPosition): Promise<void> {
  const res = await api(`/api/v1/tts/position/${bookFileId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    keepalive: true,
    body: JSON.stringify(pos),
  })
  await assertOk(res)
}

export async function deletePosition(bookFileId: number): Promise<void> {
  const res = await api(`/api/v1/tts/position/${bookFileId}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 204) await assertOk(res)
}

// ---- Chapter text (server-side fallback) ----

export async function getChapterText(bookFileId: number, chapterIndex: number): Promise<TtsChapterText> {
  const res = await api(`/api/v1/tts/text/${bookFileId}/${chapterIndex}`)
  await assertOk(res)
  return res.json() as Promise<TtsChapterText>
}

// ---- Admin ----

export async function getAdminProviders(): Promise<TtsDbProvider[]> {
  const res = await api('/api/v1/tts/admin/providers')
  await assertOk(res)
  return res.json() as Promise<TtsDbProvider[]>
}

export async function addProvider(data: {
  name: string
  baseUrl: string
  apiKey?: string
  defaultModel?: string
  staticVoices?: StaticVoiceConfig[] | null
  supportsVoiceDiscovery?: boolean
}): Promise<TtsDbProvider> {
  const res = await api('/api/v1/tts/admin/providers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  await assertOk(res)
  return res.json() as Promise<TtsDbProvider>
}

export async function updateProvider(
  id: number,
  data: Partial<{
    name: string
    baseUrl: string
    apiKey: string
    enabled: boolean
    defaultModel: string
    staticVoices: StaticVoiceConfig[] | null
    supportsVoiceDiscovery: boolean
  }>,
): Promise<TtsDbProvider> {
  const res = await api(`/api/v1/tts/admin/providers/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data.staticVoices ? { ...data, staticVoices: data.staticVoices.map(toStaticVoiceConfig) } : data),
  })
  await assertOk(res)
  return res.json() as Promise<TtsDbProvider>
}

export async function deleteProvider(id: number): Promise<void> {
  const res = await api(`/api/v1/tts/admin/providers/${id}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 204) await assertOk(res)
}

export async function discoverVoices(id: number): Promise<{ voices: StaticVoiceConfig[]; supported: boolean }> {
  const res = await api(`/api/v1/tts/admin/providers/${id}/voices/discover`)
  await assertOk(res)
  // Discovery answers with full catalog entries. They are narrowed here rather than at each call
  // site so a discovered voice can be curated and saved without a round trip through the DTO's
  // whitelist rejecting it.
  const payload = (await res.json()) as { voices: TtsVoice[]; supported: boolean }
  return { voices: (payload.voices ?? []).map(toStaticVoiceConfig), supported: payload.supported }
}

export async function testProvider(id: number): Promise<TtsProviderStatus> {
  const res = await api(`/api/v1/tts/admin/providers/${id}/test`, { method: 'POST' })
  await assertOk(res)
  return res.json() as Promise<TtsProviderStatus>
}

export async function reorderProviders(order: string[]): Promise<void> {
  const res = await api('/api/v1/tts/admin/providers/order', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order }),
  })
  if (!res.ok && res.status !== 204) await assertOk(res)
}
