// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { BookMetadataFetchConfig } from '@bookorbit/types'
import {
  clearOverrideKey,
  fetchesOnImport,
  globalChangeCount,
  mergeConfig,
  onImportChoice,
  overriddenKeys,
  overrideChangeCount,
  overrideRequestBody,
  setOverrideCondition,
  setOverrideOnImport,
  withOnImport,
} from '../auto-fetch-rules'

const global: BookMetadataFetchConfig = {
  enabled: true,
  triggerOnImport: false,
  conditions: {
    neverFetched: { enabled: true },
    scoreThreshold: { enabled: true, threshold: 60 },
    missingFields: { enabled: true, fields: ['description', 'cover'] },
  },
}

describe('auto-fetch rules', () => {
  it('treats imports as on only when both flags are on, and writes both together', () => {
    expect(fetchesOnImport(global)).toBe(false)
    const on = withOnImport(global, true)
    expect(on).toMatchObject({ enabled: true, triggerOnImport: true })
    expect(fetchesOnImport(on)).toBe(true)
    expect(withOnImport(on, false)).toMatchObject({ enabled: false, triggerOnImport: false })
  })

  it('stores only the condition a library changes, so the rest keeps following global', () => {
    const override = setOverrideCondition(global, null, 'scoreThreshold', { enabled: true, threshold: 75 })
    expect(override).toEqual({ conditions: { scoreThreshold: { enabled: true, threshold: 75 } } })
    expect(overriddenKeys(override)).toEqual(['scoreThreshold'])

    const later = { ...global, conditions: { ...global.conditions, missingFields: { enabled: true, fields: ['genres' as const] } } }
    expect(mergeConfig(later, override).conditions.missingFields.fields).toEqual(['genres'])
    expect(mergeConfig(later, override).enabled).toBe(true)
  })

  it('drops a condition set back to the global value, and the override with it', () => {
    const own = setOverrideCondition(global, null, 'missingFields', { enabled: true, fields: ['cover'] })
    expect(own).not.toBeNull()
    expect(setOverrideCondition(global, own, 'missingFields', { enabled: true, fields: ['cover', 'description'] })).toBeNull()
  })

  it('maps the on-import choice to the two flags and back', () => {
    const on = setOverrideOnImport(null, 'on')
    expect(on).toEqual({ enabled: true, triggerOnImport: true })
    expect(onImportChoice(on)).toBe('on')
    expect(onImportChoice(setOverrideOnImport(on, 'off'))).toBe('off')
    expect(setOverrideOnImport(on, 'follow')).toBeNull()
    expect(onImportChoice(null)).toBe('follow')
    expect(overriddenKeys(on)).toEqual(['onImport'])
  })

  it('reads a legacy full copy as every setting overridden', () => {
    const legacy = { ...global, conditions: { ...global.conditions } }
    expect(overriddenKeys(legacy)).toEqual(['neverFetched', 'scoreThreshold', 'missingFields', 'onImport'])
    expect(clearOverrideKey(legacy, 'onImport')).toEqual({ conditions: legacy.conditions })
    expect(clearOverrideKey(legacy, 'all')).toBeNull()
  })

  it('counts unsaved changes per setting', () => {
    const draft = withOnImport({ ...global, conditions: { ...global.conditions, scoreThreshold: { enabled: true, threshold: 70 } } }, true)
    expect(globalChangeCount(global, draft)).toBe(2)
    expect(
      globalChangeCount(global, {
        ...global,
        conditions: { ...global.conditions, missingFields: { enabled: true, fields: ['cover', 'description'] } },
      }),
    ).toBe(0)

    const saved = setOverrideCondition(global, null, 'scoreThreshold', { enabled: true, threshold: 75 })
    const edited = setOverrideOnImport(setOverrideCondition(global, saved, 'scoreThreshold', { enabled: true, threshold: 80 }), 'on')
    expect(overrideChangeCount(saved, edited)).toBe(2)
    expect(overrideChangeCount(saved, saved)).toBe(0)
  })

  it('sends an empty object to clear an override', () => {
    expect(overrideRequestBody(null)).toEqual({})
    expect(overrideRequestBody({ enabled: false })).toEqual({ enabled: false })
  })
})
