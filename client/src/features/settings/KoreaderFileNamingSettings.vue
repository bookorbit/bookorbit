<script setup lang="ts">
import { computed, onMounted, reactive, watch } from 'vue'
import type { KoreaderDeviceSweepInfo } from '@bookorbit/types'
import { DEFAULT_KOREADER_DEVICE_PATTERN, EXAMPLE_PATTERN_METADATA, resolveUploadPath } from '@bookorbit/types'
import { CircleHelp, RotateCcw, Save, Smartphone } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { useKoreaderSync } from '@/features/koreader/composables/useKoreaderSync'

interface OrganizationDraft {
  pattern: string
  seriesPattern: string
  standalonePattern: string
}

const props = defineProps<{
  devices: KoreaderDeviceSweepInfo[]
}>()

const { fileNamingPattern, fetchFileNamingPattern, saveFileNamingPattern, saveDeviceFileNamingPattern, clearDeviceFileNamingPattern } =
  useKoreaderSync()

const drafts = reactive<Record<string, OrganizationDraft>>({})
const savedDrafts = reactive<Record<string, OrganizationDraft>>({})
const saving = reactive<Record<string, boolean>>({})
const devices = computed(() => props.devices)
const seriesMetadata = { ...EXAMPLE_PATTERN_METADATA }
const standaloneMetadata = { ...EXAMPLE_PATTERN_METADATA, series: '', seriesIndex: '' }

function preview(pattern: string, fallback: string, metadata = EXAMPLE_PATTERN_METADATA) {
  return (
    resolveUploadPath(pattern.trim() || fallback, metadata, 'epub', {
      sanitizeForCrossPlatform: true,
    }) ?? ''
  )
}

const effectiveAccountDefaultPattern = computed(() => fileNamingPattern.value.trim() || DEFAULT_KOREADER_DEVICE_PATTERN)
const defaultPreview = computed(() => preview(fileNamingPattern.value, DEFAULT_KOREADER_DEVICE_PATTERN))

function emptyDraft(): OrganizationDraft {
  return { pattern: '', seriesPattern: '', standalonePattern: '' }
}

function savedDeviceDraft(device: KoreaderDeviceSweepInfo): OrganizationDraft {
  return {
    pattern: device.fileNamingPattern ?? '',
    seriesPattern: device.seriesFileNamingPattern ?? '',
    standalonePattern: device.standaloneFileNamingPattern ?? '',
  }
}

function displayDeviceDraft(saved: OrganizationDraft): OrganizationDraft {
  return {
    pattern: saved.pattern || effectiveAccountDefaultPattern.value,
    seriesPattern: saved.seriesPattern,
    standalonePattern: saved.standalonePattern,
  }
}

function normalizedDeviceDraft(deviceId: string): OrganizationDraft {
  const draft = drafts[deviceId] ?? emptyDraft()
  const pattern = draft.pattern.trim()
  return {
    pattern: pattern === effectiveAccountDefaultPattern.value.trim() ? '' : pattern,
    seriesPattern: draft.seriesPattern.trim(),
    standalonePattern: draft.standalonePattern.trim(),
  }
}

function isSameDraft(left: OrganizationDraft, right: OrganizationDraft): boolean {
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
    const stillShowingPreviousAccountDefault =
      !draft || (draft.pattern.trim() === previousPattern.trim() && !draft.seriesPattern.trim() && !draft.standalonePattern.trim())
    if (!hasSavedOverride(device.deviceId) && stillShowingPreviousAccountDefault) {
      drafts[device.deviceId] = { pattern, seriesPattern: '', standalonePattern: '' }
    }
  }
})

onMounted(async () => {
  try {
    await fetchFileNamingPattern()
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Failed to load file organization settings')
  }
})

async function saveAccountDefault() {
  if (!fileNamingPattern.value.trim()) {
    toast.error('Enter a default book path pattern before saving.')
    return
  }

  try {
    await saveFileNamingPattern({ pattern: fileNamingPattern.value.trim() })
    toast.success('Account default KOReader pattern saved')
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Failed to save file organization settings')
  }
}

async function saveDevice(deviceId: string) {
  const config = normalizedDeviceDraft(deviceId)
  saving[deviceId] = true
  try {
    if (!config.pattern && !config.seriesPattern && !config.standalonePattern) {
      await clearDeviceFileNamingPattern(deviceId)
      savedDrafts[deviceId] = emptyDraft()
      drafts[deviceId] = displayDeviceDraft(emptyDraft())
      toast.success('Device now uses the account default KOReader pattern')
      return
    }

    await saveDeviceFileNamingPattern(deviceId, config)
    savedDrafts[deviceId] = { ...config }
    drafts[deviceId] = displayDeviceDraft(config)
    toast.success('Device organization override saved')
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Failed to save device override')
  } finally {
    saving[deviceId] = false
  }
}

async function resetDevice(deviceId: string) {
  saving[deviceId] = true
  try {
    await clearDeviceFileNamingPattern(deviceId)
    savedDrafts[deviceId] = emptyDraft()
    drafts[deviceId] = displayDeviceDraft(emptyDraft())
    toast.success('Device now uses the account default KOReader pattern')
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Failed to reset device override')
  } finally {
    saving[deviceId] = false
  }
}
</script>

<template>
  <div class="space-y-5">
    <section class="rounded-lg border border-border bg-card p-5 shadow-xs">
      <div class="mb-4">
        <h2 class="text-base font-semibold text-foreground">Account default KOReader pattern</h2>
        <p class="mt-1 text-sm text-muted-foreground">
          Sets the default relative folder and filename used by BookOrbit plugin downloads for your KOReader account. Device-specific rules can
          override it below.
        </p>
      </div>
      <div class="space-y-3">
        <div>
          <div class="flex items-center gap-1.5">
            <p class="settings-label">Default book path pattern</p>
            <CircleHelp
              :size="14"
              class="text-muted-foreground"
              title="Your account default for KOReader plugin downloads unless a device has a custom rule."
            />
          </div>
          <p class="settings-hint">Used by your KOReader devices that do not have a custom override.</p>
        </div>
        <textarea
          v-model="fileNamingPattern"
          rows="3"
          class="input-field w-full min-h-24 resize-y font-mono bg-background"
          :placeholder="DEFAULT_KOREADER_DEVICE_PATTERN"
        />
        <div class="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-muted/40 border border-border/50 font-mono text-xs">
          <span class="text-muted-foreground shrink-0 uppercase tracking-wider font-semibold text-[10px]">Preview:</span>
          <span class="text-foreground break-all">{{ defaultPreview }}</span>
        </div>
      </div>
      <div class="mt-4 flex justify-end">
        <button class="settings-btn-primary inline-flex items-center gap-2" :disabled="!fileNamingPattern.trim()" @click="saveAccountDefault">
          <Save :size="15" /> Save account default
        </button>
      </div>
    </section>

    <section class="rounded-lg border border-border bg-card p-5 shadow-xs">
      <div class="mb-4">
        <h2 class="text-base font-semibold text-foreground">KOReader device overrides</h2>
        <p class="mt-1 text-sm text-muted-foreground">
          Customize any combination of default, series, and standalone paths. Empty device-specific rows inherit the device default, which itself can
          inherit the account default KOReader pattern.
        </p>
      </div>
      <div v-if="devices.length === 0" class="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Devices appear here after they sync with BookOrbit.
      </div>
      <div v-else class="space-y-3">
        <div v-for="device in devices" :key="device.deviceId" class="rounded-md border border-border bg-background/40 p-4 space-y-5">
          <div class="flex items-start justify-between gap-3">
            <div class="flex items-center gap-2">
              <Smartphone :size="17" class="text-muted-foreground" />
              <div>
                <div class="font-medium text-foreground">{{ device.deviceModel }}</div>
                <div class="text-xs text-muted-foreground">{{ device.deviceId }}</div>
              </div>
            </div>
            <span class="text-xs text-muted-foreground">{{
              hasSavedOverride(device.deviceId) ? 'Custom organization' : 'Using account default'
            }}</span>
          </div>

          <div class="space-y-2">
            <div class="flex items-center gap-1.5">
              <p class="settings-label">Default book path pattern</p>
              <CircleHelp
                :size="14"
                class="text-muted-foreground"
                title="Fallback for this device. Leave it equal to the account default to inherit future changes automatically."
              />
            </div>
            <textarea
              v-model="drafts[device.deviceId]!.pattern"
              rows="3"
              class="input-field w-full min-h-24 resize-y font-mono bg-background"
              :placeholder="effectiveAccountDefaultPattern"
            />
            <div class="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-muted/40 border border-border/50 font-mono text-xs">
              <span class="text-muted-foreground shrink-0 uppercase tracking-wider font-semibold text-[10px]">Preview:</span>
              <span class="text-foreground break-all">{{ deviceDefaultPreview(device.deviceId) }}</span>
            </div>
          </div>

          <div class="space-y-2">
            <div class="flex items-center gap-1.5">
              <p class="settings-label">Books in a series</p>
              <CircleHelp
                :size="14"
                class="text-muted-foreground"
                title="Optional path used only for books with series metadata. Leave empty to use this device's default path pattern."
              />
            </div>
            <textarea
              v-model="drafts[device.deviceId]!.seriesPattern"
              rows="3"
              class="input-field w-full min-h-24 resize-y font-mono bg-background"
              placeholder="Leave empty to use this device's default pattern"
            />
            <div class="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-muted/40 border border-border/50 font-mono text-xs">
              <span class="text-muted-foreground shrink-0 uppercase tracking-wider font-semibold text-[10px]">Preview:</span>
              <span class="text-foreground break-all">{{ deviceSeriesPreview(device.deviceId) }}</span>
            </div>
          </div>

          <div class="space-y-2">
            <div class="flex items-center gap-1.5">
              <p class="settings-label">Books without a series</p>
              <CircleHelp
                :size="14"
                class="text-muted-foreground"
                title="Optional path used only for books without series metadata. Leave empty to use this device's default path pattern."
              />
            </div>
            <textarea
              v-model="drafts[device.deviceId]!.standalonePattern"
              rows="3"
              class="input-field w-full min-h-24 resize-y font-mono bg-background"
              placeholder="Leave empty to use this device's default pattern"
            />
            <div class="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-muted/40 border border-border/50 font-mono text-xs">
              <span class="text-muted-foreground shrink-0 uppercase tracking-wider font-semibold text-[10px]">Preview:</span>
              <span class="text-foreground break-all">{{ deviceStandalonePreview(device.deviceId) }}</span>
            </div>
          </div>

          <div class="flex justify-end gap-2">
            <button
              class="settings-btn-secondary inline-flex items-center gap-2"
              :disabled="saving[device.deviceId] || (!hasSavedOverride(device.deviceId) && !hasUnsavedChanges(device.deviceId))"
              @click="resetDevice(device.deviceId)"
            >
              <RotateCcw :size="14" /> Use account default
            </button>
            <button
              class="settings-btn-primary inline-flex items-center gap-2"
              :disabled="saving[device.deviceId] || !hasUnsavedChanges(device.deviceId)"
              @click="saveDevice(device.deviceId)"
            >
              <Save :size="14" /> Save override
            </button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
