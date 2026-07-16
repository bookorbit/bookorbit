<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { VueDraggable } from 'vue-draggable-plus'
import { GripVertical } from '@lucide/vue'
import type { MetadataProviderKey, ProviderStatus } from '@bookorbit/types'
import { providerChipStyle, PROVIDER_SHORT_LABELS } from '@/lib/provider-colors'
import { PROVIDER_DND_GROUP, createProviderDragItem, type ProviderDragItem } from '../lib/provider-drag'

const { t } = useI18n()

const props = defineProps<{
  statuses: ProviderStatus[]
}>()

interface ReservoirProviderItem {
  key: MetadataProviderKey
  label: string
  usable: boolean
}

const reservoirProviders = computed<ReservoirProviderItem[]>(() =>
  props.statuses.map((status) => ({
    key: status.key as MetadataProviderKey,
    label: status.label,
    usable: status.enabled && status.configured,
  })),
)

function cloneProvider(item: ReservoirProviderItem): ProviderDragItem {
  return createProviderDragItem(item.key)
}

function providerTitle(provider: ReservoirProviderItem) {
  const status = props.statuses.find((item) => item.key === provider.key)
  if (!status?.enabled) return t('settings.metadata.fieldRules.reservoir.disabled', { provider: provider.label })
  if (!status?.configured) return t('settings.metadata.fieldRules.reservoir.notConfigured', { provider: provider.label })
  return t('settings.metadata.fieldRules.reservoir.dragToAssign', { provider: provider.label })
}
</script>

<template>
  <VueDraggable
    :model-value="reservoirProviders"
    item-key="key"
    tag="div"
    class="flex flex-wrap gap-2"
    :group="{ name: PROVIDER_DND_GROUP, pull: 'clone', put: false }"
    :sort="false"
    :animation="150"
    :clone="cloneProvider"
    handle=".provider-reservoir-handle"
  >
    <div
      v-for="provider in reservoirProviders"
      :key="provider.key"
      :title="providerTitle(provider)"
      class="flex items-center gap-1 h-6 pl-1.5 pr-2 rounded text-xs font-medium select-none transition-all"
      :style="providerChipStyle(provider.key, !provider.usable)"
      :class="
        provider.usable
          ? 'provider-reservoir-handle cursor-grab active:cursor-grabbing hover:scale-105 active:scale-95'
          : 'cursor-not-allowed opacity-40'
      "
    >
      <GripVertical v-if="provider.usable" :size="10" class="shrink-0 opacity-50" />
      <span>{{ PROVIDER_SHORT_LABELS[provider.key] ?? provider.key }}</span>
    </div>
  </VueDraggable>
</template>
