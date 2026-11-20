<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import { Loader2 } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import type { StoryGuideModelSpeed, StoryGuideSpeeds, StoryGuideStepSpeed } from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { formatDate, formatNumber } from '@/i18n/formatters'
import { errorMessage } from '@/lib/api-json'
import * as aiApi from '../api/ai.api'

const { t } = useI18n()

const speeds = ref<StoryGuideSpeeds | null>(null)
const loading = ref(true)
const failed = ref(false)
const resetting = ref<StoryGuideModelSpeed | null>(null)
const busy = ref(false)

const models = computed(() => speeds.value?.models ?? [])
const resetOpen = computed(() => resetting.value !== null)

async function load() {
  loading.value = true
  failed.value = false
  try {
    speeds.value = await aiApi.getStoryGuideSpeeds()
  } catch {
    failed.value = true
  } finally {
    loading.value = false
  }
}

onMounted(load)

function keyOf(entry: StoryGuideModelSpeed): string {
  return `${entry.connectionId}:${entry.model}:${entry.effort ?? 'auto'}`
}

/** The model, with the effort its builds ran at when the slot set one: each level learns its own speed. */
function modelLabel(entry: StoryGuideModelSpeed): string {
  if (!entry.effort) return entry.model
  return t('settings.admin.ai.features.storyGuides.speeds.modelAtEffort', {
    model: entry.model,
    level: t(`settings.admin.ai.models.efforts.${entry.effort}`),
  })
}

function learnedText(entry: StoryGuideModelSpeed): string {
  const builds = Math.max(1, ...entry.steps.map((step) => step.builds))
  return t('settings.admin.ai.features.storyGuides.speeds.learned', { count: builds, date: formatDate(new Date(entry.learnedAt)) })
}

function stepLabel(step: StoryGuideStepSpeed): string {
  return t(`settings.admin.ai.features.storyGuides.speeds.steps.${step.step}`)
}

function stepTime(step: StoryGuideStepSpeed): string {
  const time = formatNumber(step.secondsPerCall, { style: 'unit', unit: 'second', unitDisplay: 'short', maximumFractionDigits: 1 })
  return t('settings.admin.ai.features.storyGuides.speeds.perCall', { time })
}

function startReset(entry: StoryGuideModelSpeed) {
  resetting.value = entry
}

function cancelReset() {
  resetting.value = null
}

async function handleReset() {
  const entry = resetting.value
  if (!entry) return
  busy.value = true
  try {
    await aiApi.resetStoryGuideSpeed({ connectionId: entry.connectionId, model: entry.model, effort: entry.effort ?? 'auto' })
    toast.success(t('settings.admin.ai.features.storyGuides.speeds.resetDone', { model: modelLabel(entry) }))
    resetting.value = null
    await load()
  } catch (reason) {
    toast.error(errorMessage(reason, 'settings.admin.ai.features.storyGuides.speeds.resetFailed'))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="space-y-2 border-t border-border pt-4" aria-labelledby="ai-story-guide-speeds-title" data-testid="ai-story-guide-speeds">
    <h4 id="ai-story-guide-speeds-title" class="text-xs font-medium text-foreground">
      {{ t('settings.admin.ai.features.storyGuides.speeds.title') }}
    </h4>
    <p class="text-xs text-muted-foreground">{{ t('settings.admin.ai.features.storyGuides.speeds.brief') }}</p>

    <div v-if="loading" class="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
      <Loader2 class="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      <span>{{ t('settings.admin.ai.features.storyGuides.speeds.loading') }}</span>
    </div>
    <p v-else-if="failed" class="text-xs text-muted-foreground" role="alert">
      {{ t('settings.admin.ai.features.storyGuides.speeds.loadFailed') }}
      <button
        type="button"
        class="text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        @click="load"
      >
        {{ t('common.retry') }}
      </button>
    </p>
    <p v-else-if="models.length === 0" class="text-xs text-muted-foreground" data-testid="ai-story-guide-speeds-empty">
      {{ t('settings.admin.ai.features.storyGuides.speeds.none') }}
    </p>
    <ul v-else class="divide-y divide-border">
      <li
        v-for="entry in models"
        :key="keyOf(entry)"
        class="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 py-2.5"
        data-testid="ai-story-guide-speed"
      >
        <div class="min-w-0 space-y-1">
          <p class="break-all text-sm text-foreground">
            {{ modelLabel(entry) }}
            <span v-if="entry.connectionName" class="text-xs text-muted-foreground">
              {{ t('settings.admin.ai.features.storyGuides.speeds.onConnection', { connection: entry.connectionName }) }}
            </span>
          </p>
          <p class="text-xs text-muted-foreground">{{ learnedText(entry) }}</p>
          <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            <template v-for="step in entry.steps" :key="step.step">
              <dt class="text-muted-foreground">{{ stepLabel(step) }}</dt>
              <dd class="tabular-nums text-foreground">{{ stepTime(step) }}</dd>
            </template>
          </dl>
        </div>
        <Button
          variant="outline"
          size="sm"
          :aria-label="t('settings.admin.ai.features.storyGuides.speeds.resetLabel', { model: modelLabel(entry) })"
          data-testid="ai-story-guide-speed-reset"
          @click="startReset(entry)"
        >
          {{ t('settings.admin.ai.features.storyGuides.speeds.reset') }}
        </Button>
      </li>
    </ul>

    <ConfirmDialog
      :open="resetOpen"
      :title="t('settings.admin.ai.features.storyGuides.speeds.resetTitle')"
      :description="t('settings.admin.ai.features.storyGuides.speeds.resetBody', { model: resetting ? modelLabel(resetting) : '' })"
      :confirm-label="t('settings.admin.ai.features.storyGuides.speeds.reset')"
      :busy="busy"
      @confirm="handleReset"
      @cancel="cancelReset"
    />
  </section>
</template>
