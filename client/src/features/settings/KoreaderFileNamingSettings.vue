<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { KoreaderDeviceSweepInfo } from '@bookorbit/types'
import { DEFAULT_KOREADER_DEVICE_PATTERN } from '@bookorbit/types'
import { CircleHelp, RotateCcw, Save, Smartphone } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { useKoreaderSync } from '@/features/koreader/composables/useKoreaderSync'
import { useKoreaderFileNamingDrafts } from '@/features/koreader/composables/useKoreaderFileNamingDrafts'

const props = defineProps<{ devices: KoreaderDeviceSweepInfo[] }>()
const { t } = useI18n()
const { fileNamingPattern, fetchFileNamingPattern, saveFileNamingPattern, saveDeviceFileNamingPattern, clearDeviceFileNamingPattern } =
  useKoreaderSync()
const devices = computed(() => props.devices)
const saving = reactive<Record<string, boolean>>({})
const savingAccountDefault = ref(false)
const savedAccountDefaultPattern = ref('')
const hasUnsavedAccountDefault = computed(() => fileNamingPattern.value.trim() !== savedAccountDefaultPattern.value)
const {
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
} = useKoreaderFileNamingDrafts(devices, fileNamingPattern)

onMounted(async () => {
  try {
    await fetchFileNamingPattern()
    savedAccountDefaultPattern.value = fileNamingPattern.value.trim()
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('settings.reader.koreader.fileNaming.loadFailed'))
  }
})

async function saveAccountDefault() {
  if (savingAccountDefault.value) return

  if (!fileNamingPattern.value.trim()) {
    toast.error(t('settings.reader.koreader.fileNaming.accountRequired'))
    return
  }

  const pattern = fileNamingPattern.value.trim()
  savingAccountDefault.value = true
  try {
    await saveFileNamingPattern({ pattern })
    savedAccountDefaultPattern.value = pattern
    toast.success(t('settings.reader.koreader.fileNaming.accountSaved'))
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('settings.reader.koreader.fileNaming.accountSaveFailed'))
  } finally {
    savingAccountDefault.value = false
  }
}

async function saveDevice(deviceId: string) {
  if (saving[deviceId]) return

  const config = normalizedDeviceDraft(deviceId)
  saving[deviceId] = true
  try {
    if (!config.pattern && !config.seriesPattern && !config.standalonePattern) {
      await clearDeviceFileNamingPattern(deviceId)
      clearSaved(deviceId)
      toast.success(t('settings.reader.koreader.fileNaming.deviceUsesAccount'))
      return
    }

    await saveDeviceFileNamingPattern(deviceId, config)
    markSaved(deviceId, config)
    toast.success(t('settings.reader.koreader.fileNaming.deviceSaved'))
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('settings.reader.koreader.fileNaming.deviceSaveFailed'))
  } finally {
    saving[deviceId] = false
  }
}

async function resetDevice(deviceId: string) {
  if (saving[deviceId]) return

  saving[deviceId] = true
  try {
    await clearDeviceFileNamingPattern(deviceId)
    clearSaved(deviceId)
    toast.success(t('settings.reader.koreader.fileNaming.deviceUsesAccount'))
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('settings.reader.koreader.fileNaming.deviceResetFailed'))
  } finally {
    saving[deviceId] = false
  }
}
</script>

<template>
  <div class="space-y-5">
    <section class="rounded-lg border border-border bg-card p-5 shadow-xs">
      <div class="mb-4">
        <h2 class="text-base font-semibold text-foreground">{{ t('settings.reader.koreader.fileNaming.accountTitle') }}</h2>
        <p class="mt-1 text-sm text-muted-foreground">
          {{ t('settings.reader.koreader.fileNaming.accountDescription') }}
        </p>
      </div>
      <div class="space-y-3">
        <div>
          <div class="flex items-center gap-1.5">
            <p class="settings-label">{{ t('settings.reader.koreader.fileNaming.defaultPattern') }}</p>
            <CircleHelp :size="14" class="text-muted-foreground" :title="t('settings.reader.koreader.fileNaming.accountHelp')" />
          </div>
          <p class="settings-hint">{{ t('settings.reader.koreader.fileNaming.accountHint') }}</p>
        </div>
        <textarea
          v-model="fileNamingPattern"
          rows="3"
          class="input-field w-full min-h-24 resize-y font-mono bg-background"
          :placeholder="DEFAULT_KOREADER_DEVICE_PATTERN"
        />
        <div class="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-muted/40 border border-border/50 font-mono text-xs">
          <span class="text-muted-foreground shrink-0 uppercase tracking-wider font-semibold text-[10px]"
            >{{ t('settings.reader.koreader.fileNaming.preview') }}:</span
          >
          <span class="text-foreground break-all">{{ defaultPreview }}</span>
        </div>
      </div>
      <div class="mt-4 flex justify-end">
        <button
          class="settings-btn-primary inline-flex items-center gap-2"
          :disabled="savingAccountDefault || !fileNamingPattern.trim() || !hasUnsavedAccountDefault"
          @click="saveAccountDefault"
        >
          <Save :size="15" /> {{ t('common.save') }}
        </button>
      </div>
    </section>

    <section class="rounded-lg border border-border bg-card p-5 shadow-xs">
      <div class="mb-4">
        <h2 class="text-base font-semibold text-foreground">{{ t('settings.reader.koreader.fileNaming.deviceTitle') }}</h2>
        <p class="mt-1 text-sm text-muted-foreground">
          {{ t('settings.reader.koreader.fileNaming.deviceDescription') }}
        </p>
      </div>
      <div v-if="devices.length === 0" class="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        {{ t('settings.reader.koreader.fileNaming.noDevices') }}
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
              hasSavedOverride(device.deviceId)
                ? t('settings.reader.koreader.fileNaming.customOrganization')
                : t('settings.reader.koreader.fileNaming.usingAccountDefault')
            }}</span>
          </div>

          <div class="space-y-2">
            <div class="flex items-center gap-1.5">
              <p class="settings-label">{{ t('settings.reader.koreader.fileNaming.defaultPattern') }}</p>
              <CircleHelp :size="14" class="text-muted-foreground" :title="t('settings.reader.koreader.fileNaming.deviceDefaultHelp')" />
            </div>
            <textarea
              v-model="drafts[device.deviceId]!.pattern"
              rows="3"
              class="input-field w-full min-h-24 resize-y font-mono bg-background"
              :placeholder="effectiveAccountDefaultPattern"
            />
            <div class="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-muted/40 border border-border/50 font-mono text-xs">
              <span class="text-muted-foreground shrink-0 uppercase tracking-wider font-semibold text-[10px]"
                >{{ t('settings.reader.koreader.fileNaming.preview') }}:</span
              >
              <span class="text-foreground break-all">{{ deviceDefaultPreview(device.deviceId) }}</span>
            </div>
          </div>

          <div class="space-y-2">
            <div class="flex items-center gap-1.5">
              <p class="settings-label">{{ t('settings.reader.koreader.fileNaming.seriesBooks') }}</p>
              <CircleHelp :size="14" class="text-muted-foreground" :title="t('settings.reader.koreader.fileNaming.seriesHelp')" />
            </div>
            <textarea
              v-model="drafts[device.deviceId]!.seriesPattern"
              rows="3"
              class="input-field w-full min-h-24 resize-y font-mono bg-background"
              :placeholder="t('settings.reader.koreader.fileNaming.inheritPlaceholder')"
            />
            <div class="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-muted/40 border border-border/50 font-mono text-xs">
              <span class="text-muted-foreground shrink-0 uppercase tracking-wider font-semibold text-[10px]"
                >{{ t('settings.reader.koreader.fileNaming.preview') }}:</span
              >
              <span class="text-foreground break-all">{{ deviceSeriesPreview(device.deviceId) }}</span>
            </div>
          </div>

          <div class="space-y-2">
            <div class="flex items-center gap-1.5">
              <p class="settings-label">{{ t('settings.reader.koreader.fileNaming.standaloneBooks') }}</p>
              <CircleHelp :size="14" class="text-muted-foreground" :title="t('settings.reader.koreader.fileNaming.standaloneHelp')" />
            </div>
            <textarea
              v-model="drafts[device.deviceId]!.standalonePattern"
              rows="3"
              class="input-field w-full min-h-24 resize-y font-mono bg-background"
              :placeholder="t('settings.reader.koreader.fileNaming.inheritPlaceholder')"
            />
            <div class="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-muted/40 border border-border/50 font-mono text-xs">
              <span class="text-muted-foreground shrink-0 uppercase tracking-wider font-semibold text-[10px]"
                >{{ t('settings.reader.koreader.fileNaming.preview') }}:</span
              >
              <span class="text-foreground break-all">{{ deviceStandalonePreview(device.deviceId) }}</span>
            </div>
          </div>

          <div class="flex justify-end gap-2">
            <button
              class="settings-btn-secondary inline-flex items-center gap-2"
              :disabled="saving[device.deviceId] || (!hasSavedOverride(device.deviceId) && !hasUnsavedChanges(device.deviceId))"
              @click="resetDevice(device.deviceId)"
            >
              <RotateCcw :size="14" /> {{ t('settings.reader.koreader.fileNaming.useAccount') }}
            </button>
            <button
              class="settings-btn-primary inline-flex items-center gap-2"
              :disabled="saving[device.deviceId] || !hasUnsavedChanges(device.deviceId)"
              @click="saveDevice(device.deviceId)"
            >
              <Save :size="14" /> {{ t('settings.reader.koreader.fileNaming.saveOverride') }}
            </button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
