<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ChevronUp, Save } from '@lucide/vue'
import type { BookMetadataFetchConfig, BookMetadataFetchLibraryConfig, Library } from '@bookorbit/types'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import ConditionConfigurator from './ConditionConfigurator.vue'
import { useBookMetadataFetchConfig } from '@/features/book-metadata-fetch/composables/useBookMetadataFetchConfig'
import { useBookMetadataFetchActions } from '@/features/book-metadata-fetch/composables/useBookMetadataFetchActions'
import { useBookMetadataFetchStatus } from '@/features/book-metadata-fetch/composables/useBookMetadataFetchStatus'
import { invalidateEligibleCountPreviews, useEligibleCountPreview } from '@/features/book-metadata-fetch/composables/useEligibleCountPreview'
import { useMediaQuery } from '@vueuse/core'

const props = defineProps<{
  library: Library
  globalConfig: BookMetadataFetchConfig
}>()

const { t } = useI18n()
const { fetchLibraryConfig, saveLibraryConfig } = useBookMetadataFetchConfig()
const { triggerForLibrary } = useBookMetadataFetchActions()
const { status } = useBookMetadataFetchStatus()

const libraryData = ref<BookMetadataFetchLibraryConfig | null>(null)
const inheriting = ref(true)
const local = ref<BookMetadataFetchConfig | null>(null)
const saving = ref(false)
const triggering = ref(false)
const triggerResult = ref<string | null>(null)
const loading = ref(true)
const isMobile = useMediaQuery('(max-width: 767px)')
const cardOpen = ref(true)
const conditionsOpen = ref(true)

const conditions = computed(() => (inheriting.value ? props.globalConfig.conditions : (local.value?.conditions ?? null)))
const { count: eligibleCount, loading: countLoading } = useEligibleCountPreview(conditions, props.library.id)

const statusLabel = computed<string | null>(() => {
  if (triggerResult.value) return triggerResult.value
  const remaining = status.value.queued + status.value.processing
  if (remaining > 0) {
    return status.value.paused
      ? t('settings.metadata.autoFetch.status.inQueuePaused', { count: remaining })
      : t('settings.metadata.autoFetch.status.remaining', { count: remaining })
  }
  if (eligibleCount.value !== null) {
    return countLoading.value ? null : t('settings.metadata.autoFetch.status.eligible', { count: eligibleCount.value })
  }
  return null
})
const activeConditionSummary = computed(() => {
  const c = displayConfig.value.conditions
  const parts: string[] = []
  if (c.neverFetched.enabled) parts.push(t('settings.metadata.autoFetch.conditions.neverFetched.summary'))
  if (c.scoreThreshold.enabled)
    parts.push(t('settings.metadata.autoFetch.conditions.scoreThreshold.summary', { threshold: c.scoreThreshold.threshold }))
  if (c.missingFields.enabled && c.missingFields.fields.length > 0)
    parts.push(
      t('settings.metadata.autoFetch.conditions.missingFields.summary', { count: c.missingFields.fields.length }, c.missingFields.fields.length),
    )
  return parts.length > 0 ? parts.join(' • ') : t('settings.metadata.autoFetch.conditions.noneEnabled')
})

const lastRunLabel = computed(() => {
  if (!libraryData.value?.lastRunAt) return null
  const date = new Date(libraryData.value.lastRunAt)
  const diffMs = Date.now() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffMins = Math.floor(diffMs / (1000 * 60))
  let when: string
  if (diffMins < 2) when = t('settings.metadata.autoFetch.lastRun.justNow')
  else if (diffMins < 60) when = t('settings.metadata.autoFetch.lastRun.minutesAgo', { count: diffMins })
  else if (diffHours < 24) when = t('settings.metadata.autoFetch.lastRun.hoursAgo', { count: diffHours })
  else if (diffDays === 1) when = t('settings.metadata.autoFetch.lastRun.yesterday')
  else when = t('settings.metadata.autoFetch.lastRun.daysAgo', { count: diffDays })
  const queued = libraryData.value.lastQueuedCount
  if (queued === null) return t('settings.metadata.autoFetch.lastRun.label', { when })
  return queued > 0
    ? t('settings.metadata.autoFetch.lastRun.labelQueued', { when, count: queued })
    : t('settings.metadata.autoFetch.lastRun.labelNoneEligible', { when })
})

onMounted(async () => {
  try {
    applyLibraryData(await fetchLibraryConfig(props.library.id))
  } finally {
    loading.value = false
  }
})

const displayConfig = computed(() => (inheriting.value ? props.globalConfig : local.value) ?? props.globalConfig)

async function handleInheritToggle(isInheriting: boolean) {
  const wasInheriting = inheriting.value
  inheriting.value = isInheriting
  triggerResult.value = null
  const nextConfig = isInheriting || wasInheriting ? props.globalConfig : (libraryData.value ?? props.globalConfig)
  local.value = cloneConfigOnly(nextConfig)
  if (!isInheriting) return

  saving.value = true
  try {
    applyLibraryData(await saveLibraryConfig(props.library.id, null))
  } finally {
    saving.value = false
  }
}

async function handleSave() {
  if (!local.value) return
  saving.value = true
  try {
    const override = inheriting.value ? null : local.value
    applyLibraryData(await saveLibraryConfig(props.library.id, override))
  } finally {
    saving.value = false
  }
}

async function handleTrigger() {
  triggering.value = true
  triggerResult.value = null
  try {
    const { queued } = await triggerForLibrary(props.library.id)
    triggerResult.value =
      queued > 0 ? t('settings.metadata.autoFetch.trigger.queued', { count: queued }, queued) : t('settings.metadata.autoFetch.trigger.noneFound')
    invalidateEligibleCountPreviews()
    if (libraryData.value) {
      libraryData.value.lastRunAt = new Date().toISOString()
      libraryData.value.lastQueuedCount = queued
    }
  } finally {
    triggering.value = false
  }
}

watch(
  isMobile,
  (mobile) => {
    cardOpen.value = !mobile
    conditionsOpen.value = true
  },
  { immediate: true },
)

watch(
  () => props.globalConfig,
  (config) => {
    if (inheriting.value) local.value = cloneConfigOnly(config)
  },
  { deep: true },
)

function applyLibraryData(data: BookMetadataFetchLibraryConfig) {
  libraryData.value = data
  inheriting.value = data.override === null
  local.value = cloneConfigOnly(data)
}

function cloneConfigOnly(config: BookMetadataFetchConfig): BookMetadataFetchConfig {
  return {
    enabled: config.enabled,
    triggerOnImport: config.triggerOnImport,
    conditions: JSON.parse(JSON.stringify(config.conditions)),
  }
}
</script>

<template>
  <div class="border border-border rounded-lg overflow-hidden divide-y divide-border shadow-xs">
    <button
      class="w-full flex flex-col gap-2 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card text-left"
      @click="cardOpen = !cardOpen"
    >
      <div>
        <p class="settings-label">{{ props.library.name }}</p>
        <p v-if="lastRunLabel" class="text-xs text-muted-foreground mt-0.5">{{ lastRunLabel }}</p>
        <p class="text-xs text-muted-foreground mt-1 line-clamp-1">
          {{ inheriting ? t('settings.metadata.autoFetch.library.inheritingGlobal') : activeConditionSummary }}
        </p>
      </div>
      <div class="flex items-center gap-2 self-start">
        <span class="text-xs text-muted-foreground">{{ t('settings.metadata.autoFetch.library.inheritFromGlobal') }}</span>
        <ToggleSwitch :model-value="inheriting" @update:model-value="handleInheritToggle" @click.stop />
        <ChevronUp v-if="cardOpen" :size="15" class="text-muted-foreground md:hidden ml-1" />
        <ChevronDown v-else :size="15" class="text-muted-foreground md:hidden ml-1" />
      </div>
    </button>

    <div v-if="loading && cardOpen" class="px-4 py-3.5 md:px-5 md:py-4 bg-card text-xs text-muted-foreground">{{ t('common.loading') }}</div>

    <template v-else-if="cardOpen">
      <div v-if="inheriting" class="px-4 py-3.5 md:px-5 md:py-4 bg-card">
        <p class="text-xs text-muted-foreground italic">{{ t('settings.metadata.autoFetch.library.usingGlobalDefaults') }}</p>
      </div>

      <div v-else class="px-4 py-3.5 md:px-5 md:py-4 bg-card">
        <button class="w-full flex items-center justify-between gap-2 text-left" @click="conditionsOpen = !conditionsOpen">
          <p class="settings-label">{{ t('settings.metadata.autoFetch.conditions.title') }}</p>
          <ChevronUp v-if="conditionsOpen" :size="15" class="text-muted-foreground shrink-0" />
          <ChevronDown v-else :size="15" class="text-muted-foreground shrink-0" />
        </button>
        <p class="text-xs text-muted-foreground mt-1 mb-3">{{ activeConditionSummary }}</p>
        <ConditionConfigurator v-if="conditionsOpen" v-model="local!.conditions" :disabled="!displayConfig.enabled" />
      </div>

      <div class="hidden md:flex items-center gap-2 md:gap-3 flex-wrap px-4 py-3.5 md:px-5 md:py-4 bg-card">
        <button v-if="!inheriting" :disabled="saving" class="settings-btn-primary" @click="handleSave">
          <Save class="size-3.5" />
          {{ saving ? t('settings.metadata.autoFetch.saving') : t('settings.metadata.autoFetch.library.saveOverride') }}
        </button>
        <button :disabled="triggering" class="settings-btn-outline" @click="handleTrigger">
          {{ triggering ? t('settings.metadata.autoFetch.running') : t('settings.metadata.autoFetch.runNow') }}
        </button>
        <span v-if="statusLabel" class="text-xs text-muted-foreground">{{ statusLabel }}</span>
      </div>

      <div class="md:hidden sticky bottom-2 z-10 border border-border/60 bg-card/95 backdrop-blur rounded-lg px-3 py-2">
        <div class="flex items-center gap-2 flex-wrap">
          <button v-if="!inheriting" :disabled="saving" class="settings-btn-primary h-9 px-3 justify-center" @click="handleSave">
            <Save class="size-3.5" />
            {{ saving ? t('settings.metadata.autoFetch.saving') : t('settings.metadata.autoFetch.library.saveOverride') }}
          </button>
          <button :disabled="triggering" class="settings-btn-outline h-9 px-3" @click="handleTrigger">
            {{ triggering ? t('settings.metadata.autoFetch.running') : t('settings.metadata.autoFetch.runNow') }}
          </button>
          <span v-if="statusLabel" class="text-xs text-muted-foreground">{{ statusLabel }}</span>
        </div>
      </div>
    </template>
  </div>
</template>
