<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RefreshCw, RotateCcw, Search, X } from '@lucide/vue'
import { METADATA_SCORE_GROUPS, type MetadataScoreGroup, type MetadataScoreWeights } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { groupPoints } from '../lib/score-weights'

const { t } = useI18n()

const props = defineProps<{
  weights: MetadataScoreWeights
  query: string
  total: number
  scoringCount: number
  rescoring?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:query': [value: string]
  toggleGroup: [group: MetadataScoreGroup, scoring: boolean]
  resetDefaults: []
  rescore: []
}>()

/**
 * Eight provider IDs are eight rows expressing one opinion, so every group gets a single switch
 * rather than making people zero the fields one at a time.
 */
const groups = computed(() =>
  METADATA_SCORE_GROUPS.map((group) => ({
    group,
    label: t(`settings.admin.scoreWeights.groups.${group}`),
    scoring: groupPoints(props.weights, group) > 0,
  })),
)

function onQueryInput(event: Event) {
  emit('update:query', (event.target as HTMLInputElement).value)
}

function clearQuery() {
  emit('update:query', '')
}

function onToggleGroup(group: MetadataScoreGroup, scoring: boolean) {
  emit('toggleGroup', group, scoring)
}

function resetDefaults() {
  emit('resetDefaults')
}

function rescore() {
  emit('rescore')
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 md:px-6">
    <div class="relative min-w-0 basis-full md:max-w-56 md:basis-auto">
      <Search :size="14" class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <input
        type="search"
        :value="query"
        :placeholder="t('settings.admin.scoreWeights.searchFields')"
        :aria-label="t('settings.admin.scoreWeights.searchFields')"
        class="h-8 w-full rounded-md border border-input bg-background pl-8 pr-8 text-sm text-foreground outline-none transition-shadow placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
        @input="onQueryInput"
      />
      <button
        v-if="query"
        type="button"
        class="absolute right-2 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
        :aria-label="t('settings.admin.scoreWeights.clearSearch')"
        @click="clearQuery"
      >
        <X :size="13" aria-hidden="true" />
      </button>
    </div>

    <p class="order-last basis-full text-xs tabular-nums text-muted-foreground md:order-none md:basis-auto">
      {{ t('settings.admin.scoreWeights.totalSummary', { scoring: scoringCount, total }) }}
    </p>

    <div class="ml-auto flex items-center gap-2">
      <Button variant="outline" size="sm" type="button" :disabled="disabled || rescoring" @click="rescore">
        <RefreshCw :size="13" :class="rescoring ? 'animate-spin' : ''" />
        <span class="hidden sm:inline">{{ t('settings.admin.scoreWeights.recalculateAll') }}</span>
        <span class="sm:hidden">{{ t('settings.admin.scoreWeights.recalculate') }}</span>
      </Button>
      <Button variant="outline" size="sm" type="button" :disabled="disabled" @click="resetDefaults">
        <RotateCcw :size="13" />
        <span class="hidden sm:inline">{{ t('settings.admin.scoreWeights.resetToDefaultsButton') }}</span>
        <span class="sm:hidden">{{ t('settings.admin.scoreWeights.reset') }}</span>
      </Button>
    </div>
  </div>

  <div class="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-border bg-muted/15 px-4 py-1.5 md:px-6">
    <span class="basis-full text-[10px] font-semibold uppercase tracking-wider text-muted-foreground md:basis-auto">
      {{ t('settings.admin.scoreWeights.countGroups') }}
    </span>
    <!-- role="switch" cannot be wrapped in a label, so the visible name is bound with aria-labelledby. -->
    <div v-for="entry in groups" :key="entry.group" class="flex items-center gap-2">
      <ToggleSwitch
        :model-value="entry.scoring"
        :disabled="disabled"
        :aria-labelledby="`score-group-${entry.group}`"
        @update:model-value="(value: boolean) => onToggleGroup(entry.group, value)"
      />
      <span :id="`score-group-${entry.group}`" class="text-xs text-foreground">{{ entry.label }}</span>
    </div>
  </div>
</template>
