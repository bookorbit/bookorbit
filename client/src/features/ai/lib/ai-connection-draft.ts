import {
  AI_CONNECTION_LIMITS,
  AI_PRESETS,
  AI_RESERVED_HEADER_NAMES,
  detectAiConnection,
  isAiApiType,
  normaliseAiBaseUrl,
  type AiApiType,
  type AiConnection,
  type AiConnectionHeaderInput,
  type AiPresetId,
  type CreateAiConnectionRequest,
  type NetworkProfile,
  type TestAiConnectionRequest,
  type UpdateAiConnectionRequest,
} from '@bookorbit/types'

export interface AiHeaderDraft {
  name: string
  /** Empty with a stored hint keeps the stored value. */
  value: string
  /** Last four characters of the value saved on the server, when there is one. */
  storedHint: string | null
}

/** The form's own shape: numbers stay as typed until they are sent, so a half-typed field is not lost. */
export interface AiConnectionDraft {
  presetId: AiPresetId
  name: string
  apiType: AiApiType
  baseUrl: string
  key: string
  /** Editing only: the saved key goes when this is saved. */
  removeKey: boolean
  headers: AiHeaderDraft[]
  proxyUrl: string
  resolvers: string[]
  timeoutSeconds: string
  maxParallel: string
  /** Empty for no limit. */
  requestsPerMinute: string
}

export type AiDraftField = 'name' | 'baseUrl' | 'key' | 'headers' | 'timeoutSeconds' | 'maxParallel' | 'requestsPerMinute'

/** Each failing field and the message key that says why, with its parameters. */
export type AiDraftErrors = Partial<Record<AiDraftField, { key: string; params?: Record<string, string | number> }>>

const MS_PER_SECOND = 1000
const RESERVED = new Set<string>(AI_RESERVED_HEADER_NAMES)

function defaults(): Pick<
  AiConnectionDraft,
  'timeoutSeconds' | 'maxParallel' | 'requestsPerMinute' | 'proxyUrl' | 'resolvers' | 'key' | 'removeKey'
> {
  return {
    timeoutSeconds: String(AI_CONNECTION_LIMITS.timeoutMs.default / MS_PER_SECOND),
    maxParallel: String(AI_CONNECTION_LIMITS.maxParallel.default),
    requestsPerMinute: '',
    proxyUrl: '',
    resolvers: [],
    key: '',
    removeKey: false,
  }
}

export function draftFromPreset(presetId: AiPresetId): AiConnectionDraft {
  const preset = AI_PRESETS[presetId]
  return {
    ...defaults(),
    presetId,
    name: presetId === 'other' ? '' : preset.name,
    apiType: preset.apiType,
    baseUrl: preset.baseUrl,
    headers: preset.headers.map((header) => ({ name: header.name, value: header.value, storedHint: null })),
  }
}

/** A pasted URL picks the preset and API type; null when it cannot be read as a URL at all. */
export function draftFromUrl(raw: string): AiConnectionDraft | null {
  const detected = detectAiConnection(raw)
  if (!detected) return null
  return { ...draftFromPreset(detected.preset), apiType: detected.apiType, baseUrl: detected.baseUrl }
}

export function draftFromConnection(connection: AiConnection): AiConnectionDraft {
  const apiType = isAiApiType(connection.apiType) ? connection.apiType : 'openai-chat'
  return {
    ...defaults(),
    presetId: detectAiConnection(connection.baseUrl)?.preset ?? 'other',
    name: connection.name,
    apiType,
    baseUrl: connection.baseUrl,
    headers: connection.headers.map((header) => ({ name: header.name, value: '', storedHint: header.hasValue ? (header.valueHint ?? '') : null })),
    proxyUrl: connection.networkProfile?.proxyUrl ?? '',
    resolvers: [...(connection.networkProfile?.resolvers ?? [])],
    timeoutSeconds: String(Math.round(connection.timeoutMs / MS_PER_SECOND)),
    maxParallel: String(connection.maxParallel),
    requestsPerMinute: connection.requestsPerMinute === null ? '' : String(connection.requestsPerMinute),
  }
}

/** Where the request will actually go, shown under the URL field as the admin types. */
export function normalisedBaseUrl(draft: AiConnectionDraft): string {
  return draft.baseUrl.trim() ? normaliseAiBaseUrl(draft.baseUrl, draft.apiType) : ''
}

function integerIn(value: string, min: number, max: number): number | null {
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const parsed = Number(trimmed)
  return parsed >= min && parsed <= max ? parsed : null
}

export function validateDraft(draft: AiConnectionDraft, keyRequired: boolean): AiDraftErrors {
  const errors: AiDraftErrors = {}
  if (!draft.name.trim()) errors.name = { key: 'settings.admin.ai.sheet.errors.nameRequired' }
  const url = draft.baseUrl.trim()
  if (!url) errors.baseUrl = { key: 'settings.admin.ai.sheet.errors.urlRequired' }
  else if (!/^https?:\/\/[^\s/]+/i.test(url) || url.includes('<')) errors.baseUrl = { key: 'settings.admin.ai.sheet.errors.urlInvalid' }
  if (keyRequired && !draft.key.trim()) errors.key = { key: 'settings.admin.ai.sheet.errors.keyRequired' }

  for (const header of draft.headers) {
    const name = header.name.trim()
    if (!name && !header.value) continue
    if (!name) {
      errors.headers = { key: 'settings.admin.ai.sheet.errors.headerNameRequired' }
      break
    }
    if (RESERVED.has(name.toLowerCase())) {
      errors.headers = { key: 'settings.admin.ai.sheet.errors.headerReserved', params: { name } }
      break
    }
    if (!header.value && header.storedHint === null) {
      errors.headers = { key: 'settings.admin.ai.sheet.errors.headerValueRequired', params: { name } }
      break
    }
  }

  const timeout = AI_CONNECTION_LIMITS.timeoutMs
  if (integerIn(draft.timeoutSeconds, timeout.min / MS_PER_SECOND, timeout.max / MS_PER_SECOND) === null) {
    errors.timeoutSeconds = {
      key: 'settings.admin.ai.sheet.errors.range',
      params: { min: timeout.min / MS_PER_SECOND, max: timeout.max / MS_PER_SECOND },
    }
  }
  const parallel = AI_CONNECTION_LIMITS.maxParallel
  if (integerIn(draft.maxParallel, parallel.min, parallel.max) === null) {
    errors.maxParallel = { key: 'settings.admin.ai.sheet.errors.range', params: { min: parallel.min, max: parallel.max } }
  }
  const perMinute = AI_CONNECTION_LIMITS.requestsPerMinute
  if (draft.requestsPerMinute.trim() && integerIn(draft.requestsPerMinute, perMinute.min, perMinute.max) === null) {
    errors.requestsPerMinute = { key: 'settings.admin.ai.sheet.errors.range', params: { min: perMinute.min, max: perMinute.max } }
  }
  return errors
}

function headersOf(draft: AiConnectionDraft): AiConnectionHeaderInput[] {
  return draft.headers
    .filter((header) => header.name.trim())
    .map((header) => (header.value ? { name: header.name.trim(), value: header.value } : { name: header.name.trim() }))
}

function networkProfileOf(draft: AiConnectionDraft): NetworkProfile | null {
  const proxyUrl = draft.proxyUrl.trim()
  const resolvers = draft.resolvers.map((resolver) => resolver.trim()).filter(Boolean)
  if (!proxyUrl && resolvers.length === 0) return null
  return { ...(proxyUrl ? { proxyUrl } : {}), ...(resolvers.length ? { resolvers } : {}) }
}

function sharedFields(draft: AiConnectionDraft): Omit<CreateAiConnectionRequest, 'key'> {
  const perMinute = draft.requestsPerMinute.trim()
  return {
    name: draft.name.trim(),
    apiType: draft.apiType,
    baseUrl: draft.baseUrl.trim(),
    headers: headersOf(draft),
    networkProfile: networkProfileOf(draft),
    timeoutMs: Number(draft.timeoutSeconds.trim()) * MS_PER_SECOND,
    maxParallel: Number(draft.maxParallel.trim()),
    requestsPerMinute: perMinute ? Number(perMinute) : null,
  }
}

/** Absent keeps the stored key, null removes it, a value replaces it. */
function keyChange(draft: AiConnectionDraft): { key?: string | null } {
  if (draft.removeKey) return { key: null }
  return draft.key.trim() ? { key: draft.key.trim() } : {}
}

export function createRequest(draft: AiConnectionDraft): CreateAiConnectionRequest {
  return { ...sharedFields(draft), ...keyChange(draft) }
}

export function updateRequest(draft: AiConnectionDraft): UpdateAiConnectionRequest {
  return { ...sharedFields(draft), ...keyChange(draft) }
}

/** Testing an edit names the saved connection, so a key or header value not typed again is read from it. */
export function testRequest(draft: AiConnectionDraft, connectionId: number | null, model: string | null): TestAiConnectionRequest {
  return {
    ...sharedFields(draft),
    ...keyChange(draft),
    ...(connectionId !== null ? { connectionId } : {}),
    ...(model ? { model } : {}),
  }
}
