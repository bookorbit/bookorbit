<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ChevronUp, Save } from '@lucide/vue'
import type { BookMetadataFetchConfig } from '@bookorbit/types'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import ConditionConfigurator from './ConditionConfigurator.vue'
import { useBookMetadataFetchConfig } from '@/features/book-metadata-fetch/composables/useBookMetadataFetchConfig'
import { useBookMetadataFetchActions } from '@/features/book-metadata-fetch/composables/useBookMetadataFetchActions'
import { useBookMetadataFetchStatus } from '@/features/book-metadata-fetch/composables/useBookMetadataFetchStatus'
import { invalidateEligibleCountPreviews, useEligibleCountPreview } from '@/features/book-metadata-fetch/composables/useEligibleCountPreview'
import { useMediaQuery } from '@vueuse/core'

const { t } = useI18n()
const { saveGlobalConfig } = useBookMetadataFetchConfig()
const { triggerGlobal } = useBookMetadataFetchActions()
const { status } = useBookMetadataFetchStatus()

const props = defineProps<{ config: BookMetadataFetchConfig }>()
const emit = defineEmits<{ updated: [BookMetadataFetchConfig] }>()

const local = ref<BookMetadataFetchConfig>(JSON.parse(JSON.stringify(props.config)))
const saving = ref(false)
const triggering = ref(false)
const triggerResult = ref<string | null>(null)
const isMobile = useMediaQuery('(max-width: 767px)')
const conditionsOpen = ref(true)

const conditions = computed(() => local.value.conditions)
const { count: eligibleCount, loading: countLoading } = useEligibleCountPreview(conditions)

const statusLabel = computed<string | null>(() => {
  if (triggerResult.value) return triggerResult.value
  const remaining = status.value.queued + status.value.processing
  if (remaining > 0) {
    return status.value.paused
      ? t('settings.metadata.autoFetch.status.inQueuePaused', {
          count: remaining,
        })
      : t('settings.metadata.autoFetch.status.remaining', { count: remaining })
  }
  if (eligibleCount.value !== null) {
    return countLoading.value
      ? null
      : t('settings.metadata.autoFetch.status.eligible', {
          count: eligibleCount.value,
        })
  }
  return null
})
const activeConditionSummary = computed(() => {
  const c = local.value.conditions
  const parts: string[] = []
  if (c.neverFetched.enabled) parts.push(t('settings.metadata.autoFetch.conditions.neverFetched.summary'))
  if (c.scoreThreshold.enabled)
    parts.push(
      t('settings.metadata.autoFetch.conditions.scoreThreshold.summary', {
        threshold: c.scoreThreshold.threshold,
      }),
    )
  if (c.missingFields.enabled && c.missingFields.fields.length > 0)
    parts.push(
      t('settings.metadata.autoFetch.conditions.missingFields.summary', {
        count: c.missingFields.fields.length,
      }),
    )
  return parts.length > 0 ? parts.join(' • ') : t('settings.metadata.autoFetch.conditions.noneEnabled')
})

watch(
  () => props.config,
  (c) => {
    local.value = JSON.parse(JSON.stringify(c))
  },
  { deep: true },
)
watch(
  isMobile,
  () => {
    conditionsOpen.value = true
  },
  { immediate: true },
)

async function handleSave() {
  saving.value = true
  try {
    const updated = await saveGlobalConfig(local.value)
    emit('updated', updated)
  } finally {
    saving.value = false
  }
}

async function handleTrigger() {
  triggering.value = true
  triggerResult.value = null
  try {
    const { queued } = await triggerGlobal()
    triggerResult.value =
      queued > 0 ? t('settings.metadata.autoFetch.trigger.queued', { count: queued }) : t('settings.metadata.autoFetch.trigger.noneFound')
    invalidateEligibleCountPreviews()
  } finally {
    triggering.value = false
  }
}
function toggleConditions() {
  conditionsOpen.value = !conditionsOpen.value
}
</script>

<template>
  <div class="settings-card">
    <div class="px-4 py-3.5 md:px-5 md:py-4 bg-card">
      <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p class="settings-label">
            {{ t('settings.metadata.autoFetch.enable.label') }}
          </p>
          <p class="settings-hint">
            {{ t('settings.metadata.autoFetch.enable.hint') }}
          </p>
        </div>
        <ToggleSwitch class="self-start" v-model="local.enabled" />
      </div>
    </div>

    <div class="px-4 py-3.5 md:px-5 md:py-4 bg-card">
      <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p class="settings-label">
            {{ t('settings.metadata.autoFetch.triggerOnImport.label') }}
          </p>
          <p class="settings-hint">
            {{ t('settings.metadata.autoFetch.triggerOnImport.hint') }}
          </p>
        </div>
        <ToggleSwitch class="self-start" v-model="local.triggerOnImport" :disabled="!local.enabled" />
      </div>
    </div>

    <div class="px-4 py-3.5 md:px-5 md:py-4 bg-card">
      <button class="w-full flex items-center justify-between gap-2 text-left" @click="toggleConditions">
        <p class="settings-label">
          {{ t('settings.metadata.autoFetch.conditions.title') }}
        </p>
        <ChevronUp v-if="conditionsOpen" :size="15" class="text-muted-foreground shrink-0" />
        <ChevronDown v-else :size="15" class="text-muted-foreground shrink-0" />
      </button>
      <p class="settings-hint mt-1 mb-4">
        {{ t('settings.metadata.autoFetch.conditions.hint') }}
      </p>
      <p class="text-xs text-muted-foreground mb-3">
        {{ activeConditionSummary }}
      </p>
      <ConditionConfigurator v-if="conditionsOpen" v-model="local.conditions" />
    </div>

    <div class="md:hidden sticky bottom-2 z-10 border border-border/60 bg-card/95 backdrop-blur rounded-lg px-3 py-2">
      <div class="flex items-center gap-2 flex-wrap">
        <Button size="sm" :disabled="saving" class="px-3" @click="handleSave" type="button">
          <Save class="size-3.5" />
          {{ saving ? t('settings.metadata.autoFetch.saving') : t('common.save') }}
        </Button>
        <Button variant="outline" size="sm" :disabled="triggering" class="h-9 px-3" @click="handleTrigger" type="button">
          {{ triggering ? t('settings.metadata.autoFetch.running') : t('settings.metadata.autoFetch.runNow') }}
        </Button>
        <span v-if="statusLabel" class="text-xs text-muted-foreground">{{ statusLabel }}</span>
      </div>
    </div>

    <div class="hidden md:flex items-center gap-3 px-5 py-4 bg-card">
      <Button size="sm" :disabled="saving" @click="handleSave" type="button">
        <Save class="size-3.5" />
        {{ saving ? t('settings.metadata.autoFetch.saving') : t('common.save') }}
      </Button>
      <div class="w-px h-4 bg-border shrink-0" />
      <Button variant="outline" size="sm" :disabled="triggering" @click="handleTrigger" type="button">
        {{ triggering ? t('settings.metadata.autoFetch.running') : t('settings.metadata.autoFetch.runForEligible') }}
      </Button>
      <span v-if="statusLabel" class="text-xs text-muted-foreground">{{ statusLabel }}</span>
    </div>
  </div>
</template>
