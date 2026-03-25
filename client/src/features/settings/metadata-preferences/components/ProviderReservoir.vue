<script setup lang="ts">
import { computed } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import { GripVertical } from 'lucide-vue-next'
import type { MetadataProviderKey, ProviderStatus } from '@projectx/types'
import { providerChipStyle, PROVIDER_SHORT_LABELS } from '@/lib/provider-colors'
import { PROVIDER_DND_GROUP, createProviderDragItem, type ProviderDragItem } from '../lib/provider-drag'

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
  if (!status?.enabled) return `${provider.label} - disabled`
  if (!status?.configured) return `${provider.label} - not configured`
  return `Drag to assign ${provider.label} to a field`
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
      class="flex items-center gap-1.5 h-7 px-3 rounded text-[10px] font-bold uppercase tracking-tight select-none transition-all shadow-xs"
      :style="providerChipStyle(provider.key, !provider.usable)"
      :class="
        provider.usable
          ? 'provider-reservoir-handle cursor-grab active:cursor-grabbing hover:scale-105 active:scale-95'
          : 'cursor-not-allowed opacity-40'
      "
    >
      <GripVertical v-if="provider.usable" :size="10" class="shrink-0 -ml-1 opacity-50" />
      <span>{{ PROVIDER_SHORT_LABELS[provider.key] ?? provider.key }}</span>
    </div>
  </VueDraggable>
</template>
