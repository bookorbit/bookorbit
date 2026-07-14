import { computed, reactive, watch, type Ref } from 'vue'
import type { KoreaderDeviceSweepInfo } from '@bookorbit/types'
import { DEFAULT_KOREADER_DEVICE_PATTERN, EXAMPLE_PATTERN_METADATA, resolveUploadPath } from '@bookorbit/types'

export interface KoreaderFileNamingDraft {
  pattern: string
  seriesPattern: string
  standalonePattern: string
}

export function useKoreaderFileNamingDrafts(devices: Ref<KoreaderDeviceSweepInfo[]>, accountPattern: Ref<string>) {
  const drafts = reactive<Record<string, KoreaderFileNamingDraft>>({})
  const savedDrafts = reactive<Record<string, KoreaderFileNamingDraft>>({})
  const seriesMetadata = { ...EXAMPLE_PATTERN_METADATA }
  const standaloneMetadata = { ...EXAMPLE_PATTERN_METADATA, series: '', seriesIndex: '' }

  const effectiveAccountDefaultPattern = computed(() => accountPattern.value.trim() || DEFAULT_KOREADER_DEVICE_PATTERN)
  const defaultPreview = computed(() => preview(accountPattern.value, DEFAULT_KOREADER_DEVICE_PATTERN))

  function preview(pattern: string, fallback: string, metadata = EXAMPLE_PATTERN_METADATA): string {
    return resolveUploadPath(pattern.trim() || fallback, metadata, 'epub', { sanitizeForCrossPlatform: true }) ?? ''
  }

  function emptyDraft(): KoreaderFileNamingDraft {
    return { pattern: '', seriesPattern: '', standalonePattern: '' }
  }

  function savedDeviceDraft(device: KoreaderDeviceSweepInfo): KoreaderFileNamingDraft {
    return {
      pattern: device.fileNamingPattern ?? '',
      seriesPattern: device.seriesFileNamingPattern ?? '',
      standalonePattern: device.standaloneFileNamingPattern ?? '',
    }
  }

  function displayDeviceDraft(saved: KoreaderFileNamingDraft): KoreaderFileNamingDraft {
    return {
      pattern: saved.pattern || effectiveAccountDefaultPattern.value,
      seriesPattern: saved.seriesPattern,
      standalonePattern: saved.standalonePattern,
    }
  }

  function normalizedDeviceDraft(deviceId: string): KoreaderFileNamingDraft {
    const draft = drafts[deviceId] ?? emptyDraft()
    const pattern = draft.pattern.trim()
    return {
      pattern: pattern === effectiveAccountDefaultPattern.value.trim() ? '' : pattern,
      seriesPattern: draft.seriesPattern.trim(),
      standalonePattern: draft.standalonePattern.trim(),
    }
  }

  function isSameDraft(left: KoreaderFileNamingDraft, right: KoreaderFileNamingDraft): boolean {
    return left.pattern === right.pattern && left.seriesPattern === right.seriesPattern && left.standalonePattern === right.standalonePattern
  }

  function hasSavedOverride(deviceId: string): boolean {
    const saved = savedDrafts[deviceId] ?? emptyDraft()
    return Boolean(saved.pattern || saved.seriesPattern || saved.standalonePattern)
  }

  function hasUnsavedChanges(deviceId: string): boolean {
    return !isSameDraft(normalizedDeviceDraft(deviceId), savedDrafts[deviceId] ?? emptyDraft())
  }

  function deviceDefaultPattern(deviceId: string): string {
    return normalizedDeviceDraft(deviceId).pattern || effectiveAccountDefaultPattern.value
  }

  function deviceDefaultPreview(deviceId: string): string {
    return preview(normalizedDeviceDraft(deviceId).pattern, effectiveAccountDefaultPattern.value)
  }

  function deviceSeriesPreview(deviceId: string): string {
    return preview(drafts[deviceId]?.seriesPattern ?? '', deviceDefaultPattern(deviceId), seriesMetadata)
  }

  function deviceStandalonePreview(deviceId: string): string {
    return preview(drafts[deviceId]?.standalonePattern ?? '', deviceDefaultPattern(deviceId), standaloneMetadata)
  }

  function markSaved(deviceId: string, config: KoreaderFileNamingDraft): void {
    savedDrafts[deviceId] = { ...config }
    drafts[deviceId] = displayDeviceDraft(config)
  }

  function clearSaved(deviceId: string): void {
    markSaved(deviceId, emptyDraft())
  }

  watch(
    devices,
    (rows) => {
      for (const device of rows) {
        const hadDraft = Boolean(drafts[device.deviceId])
        const wasDirty = hadDraft && hasUnsavedChanges(device.deviceId)
        const saved = savedDeviceDraft(device)
        savedDrafts[device.deviceId] = saved
        if (!hadDraft || !wasDirty) drafts[device.deviceId] = displayDeviceDraft(saved)
      }
    },
    { immediate: true },
  )

  watch(effectiveAccountDefaultPattern, (pattern, previousPattern) => {
    for (const device of devices.value) {
      const draft = drafts[device.deviceId]
      const saved = savedDrafts[device.deviceId] ?? emptyDraft()
      if (!saved.pattern && (!draft || draft.pattern.trim() === previousPattern.trim())) {
        drafts[device.deviceId] = { ...(draft ?? emptyDraft()), pattern }
      }
    }
  })

  return {
    drafts,
    effectiveAccountDefaultPattern,
    defaultPreview,
    normalizedDeviceDraft,
    hasSavedOverride,
    hasUnsavedChanges,
    deviceDefaultPreview,
    deviceSeriesPreview,
    deviceStandalonePreview,
    markSaved,
    clearSaved,
  }
}
