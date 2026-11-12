<script setup lang="ts">
import { computed } from 'vue'
import { Loader2 } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { AI_FEATURE_DEFINITIONS, type AiSettings, type AiSlot } from '@bookorbit/types'

import LoadErrorPanel from '@/components/LoadErrorPanel.vue'
import type { AiLoadState } from '../composables/useAiAdmin'
import AiFeatureRow from './AiFeatureRow.vue'

const props = defineProps<{
  settings: AiSettings | null
  state: AiLoadState
}>()

const emit = defineEmits<{
  retry: []
  updated: [settings: AiSettings]
  showSlot: [slot: AiSlot]
}>()

const { t } = useI18n()

/** A newer server can list a feature this page has no limits for; it is managed from a newer page. */
const features = computed(() => (props.settings?.features ?? []).filter((feature) => Object.hasOwn(AI_FEATURE_DEFINITIONS, feature.id)))
</script>

<template>
  <section aria-labelledby="ai-features-title" class="flex flex-col gap-3" data-testid="ai-features">
    <div>
      <h3 id="ai-features-title" class="settings-group-label mb-0">{{ t('settings.admin.ai.features.title') }}</h3>
      <p class="settings-hint">{{ t('settings.admin.ai.features.brief') }}</p>
    </div>

    <div v-if="state === 'loading'" class="settings-loading-state">
      <Loader2 class="size-5 animate-spin" aria-hidden="true" />
      <span class="sr-only">{{ t('settings.admin.ai.loading') }}</span>
    </div>

    <div v-else-if="state === 'error' || !settings" class="settings-card">
      <LoadErrorPanel :message="t('settings.admin.ai.features.loadFailed')" @retry="emit('retry')" />
    </div>

    <p v-else-if="features.length === 0" class="settings-empty-state text-xs">{{ t('settings.admin.ai.features.empty') }}</p>

    <div v-else class="settings-card">
      <AiFeatureRow
        v-for="feature in features"
        :key="feature.id"
        :feature="feature"
        @updated="(next) => emit('updated', next)"
        @show-slot="(slot) => emit('showSlot', slot)"
      />
    </div>
  </section>
</template>
