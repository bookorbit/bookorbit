<script setup lang="ts">
import { computed } from 'vue'
import { Loader2 } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import {
  AI_FEATURE_DEFINITIONS,
  type AiConnection,
  type AiFeatureId,
  type AiFeatureState,
  type AiOverview,
  type AiSettings,
  type AiSlot,
  type AiUsageReport,
} from '@bookorbit/types'

import LoadErrorPanel from '@/components/LoadErrorPanel.vue'
import type { AiLoadState } from '../composables/useAiAdmin'
import { aiColumns, aiTable } from '../lib/ai-settings-ui'
import AiFeatureRow from './AiFeatureRow.vue'
import AiSectionHeader from './AiSectionHeader.vue'

const props = defineProps<{
  settings: AiSettings | null
  state: AiLoadState
  connections: AiConnection[]
  overview: AiOverview | null
  monthUsage: AiUsageReport | null
  /** Which feature editors are open, as `feature:<id>` keys the page shares with its other tables. */
  openKeys: ReadonlySet<string>
}>()

const emit = defineEmits<{
  retry: []
  updated: [settings: AiSettings]
  setOpen: [key: string, open: boolean]
  openSlot: [slot: AiSlot]
}>()

const { t } = useI18n()

/** A newer server can list a feature this page has no limits for; it is managed from a newer page. */
const features = computed(() => (props.settings?.features ?? []).filter((feature) => Object.hasOwn(AI_FEATURE_DEFINITIONS, feature.id)))

/** A required slot whose model is failing, or whose provider is, so the feature's requests fail too. */
function failingSlot(feature: AiFeatureState): AiSlot | null {
  const settings = props.settings
  if (!settings) return null
  for (const slot of AI_FEATURE_DEFINITIONS[feature.id].slots) {
    if (settings.slotHealth[slot]) return slot
    const connectionId = settings.slots[slot].connectionId
    if (connectionId !== null && props.connections.some((connection) => connection.id === connectionId && connection.status === 'failing'))
      return slot
  }
  return null
}

/** Builds for a feature that runs jobs, requests for one that answers them. */
function monthOf(id: AiFeatureId): { costMicros: number; count: number } | null {
  const usage = props.monthUsage
  if (!usage) return null
  const row = usage.byFeature.find((entry) => entry.feature === id)
  const count = AI_FEATURE_DEFINITIONS[id].runs === 'jobs' ? (props.overview?.budget.buildsThisMonth ?? 0) : (row?.requests ?? 0)
  return { costMicros: row?.costMicros ?? 0, count }
}

function keyOf(id: AiFeatureId): string {
  return `feature:${id}`
}

function handleRetry() {
  emit('retry')
}

function handleUpdated(next: AiSettings) {
  emit('updated', next)
}

function handleSetOpen(id: AiFeatureId, open: boolean) {
  emit('setOpen', keyOf(id), open)
}

function handleOpenSlot(slot: AiSlot) {
  emit('openSlot', slot)
}
</script>

<template>
  <section aria-labelledby="ai-features-title" class="flex min-w-0 flex-col gap-2.5" data-testid="ai-features">
    <AiSectionHeader title-id="ai-features-title" :title="t('settings.admin.ai.features.title')" :hint="t('settings.admin.ai.features.hint')" />

    <div v-if="state === 'loading'" class="settings-loading-state">
      <Loader2 class="size-5 animate-spin" aria-hidden="true" />
      <span class="sr-only">{{ t('settings.admin.ai.loading') }}</span>
    </div>

    <div v-else-if="state === 'error' || !settings" class="settings-card">
      <LoadErrorPanel :message="t('settings.admin.ai.features.loadFailed')" @retry="handleRetry" />
    </div>

    <p v-else-if="features.length === 0" class="settings-empty-state text-xs">{{ t('settings.admin.ai.features.empty') }}</p>

    <div v-else :class="aiTable.card">
      <div :class="[aiTable.head, aiColumns.features]" aria-hidden="true">
        <span>{{ t('settings.admin.ai.features.columns.feature') }}</span>
        <span>{{ t('settings.admin.ai.features.columns.runsOn') }}</span>
        <span>{{ t('settings.admin.ai.features.columns.limits') }}</span>
        <span class="text-end">{{ t('settings.admin.ai.features.columns.month') }}</span>
        <span class="text-center">{{ t('settings.admin.ai.features.columns.on') }}</span>
        <span />
      </div>
      <ul :class="aiTable.list" aria-labelledby="ai-features-title">
        <AiFeatureRow
          v-for="feature in features"
          :key="feature.id"
          :feature="feature"
          :open="openKeys.has(keyOf(feature.id))"
          :failing-slot="failingSlot(feature)"
          :month="monthOf(feature.id)"
          @updated="handleUpdated"
          @set-open="handleSetOpen(feature.id, $event)"
          @open-slot="handleOpenSlot"
        />
      </ul>
    </div>
  </section>
</template>
