<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { VueDraggable } from 'vue-draggable-plus'
import { GripVertical, X } from '@lucide/vue'
import type { MetadataProviderKey, ProviderStatus } from '@bookorbit/types'
import { providerChipStyle, PROVIDER_SHORT_LABELS } from '@/lib/provider-colors'
import { PROVIDER_DND_GROUP, toProviderDragItems } from '../lib/provider-drag'

const { t } = useI18n()

const props = defineProps<{
  providers: MetadataProviderKey[]
  statuses: ProviderStatus[]
  disabled?: boolean
}>()

const emit = defineEmits<{ 'update:providers': [value: MetadataProviderKey[]] }>()

interface ProviderChipItem {
  key: MetadataProviderKey
  dragId: string
}

function statusFor(key: MetadataProviderKey) {
  return props.statuses.find((s) => s.key === key)
}

function isUsable(key: MetadataProviderKey) {
  const s = statusFor(key)
  return s ? s.enabled && s.configured : true
}

const localProviders = ref<ProviderChipItem[]>([])
const isDragging = ref(false)

watch(
  () => props.providers,
  (providers) => {
    if (isDragging.value) return
    localProviders.value = toProviderDragItems(providers)
  },
  { immediate: true },
)

function sameOrder(a: MetadataProviderKey[], b: MetadataProviderKey[]) {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function commitProviders() {
  const seen = new Set<MetadataProviderKey>()
  const deduplicated = localProviders.value.filter((item) => {
    if (seen.has(item.key)) return false
    seen.add(item.key)
    return true
  })
  if (deduplicated.length !== localProviders.value.length) {
    localProviders.value = deduplicated
  }
  const normalized = deduplicated.map((item) => item.key)
  if (!sameOrder(normalized, props.providers)) {
    emit('update:providers', normalized)
  }
}

function onDragStart() {
  isDragging.value = true
}

function onDragEnd() {
  isDragging.value = false
  commitProviders()
}

function removeProvider(index: number) {
  const updated = [...localProviders.value]
  updated.splice(index, 1)
  localProviders.value = updated
  commitProviders()
}
</script>

<template>
  <div class="min-h-[26px]">
    <VueDraggable
      v-model="localProviders"
      item-key="dragId"
      tag="div"
      class="flex flex-wrap gap-1.5 min-h-[26px] items-center"
      :animation="150"
      :group="{ name: PROVIDER_DND_GROUP, pull: false, put: true }"
      handle=".provider-chip-handle"
      ghost-class="opacity-40"
      chosen-class="provider-chip-chosen"
      drag-class="scale-95"
      :disabled="disabled"
      @start="onDragStart"
      @add="commitProviders"
      @end="onDragEnd"
    >
      <div
        v-for="(item, index) in localProviders"
        :key="item.dragId"
        :title="statusFor(item.key)?.label ?? item.key"
        class="flex items-center gap-1 h-6 pl-1.5 pr-1 rounded text-xs font-medium select-none transition-transform"
        :style="providerChipStyle(item.key, !isUsable(item.key))"
        :class="!disabled ? 'provider-chip-handle cursor-grab active:cursor-grabbing' : 'cursor-default'"
      >
        <GripVertical v-if="!disabled" :size="10" class="opacity-50 shrink-0" />
        <span class="opacity-70 tabular-nums leading-none">{{ index + 1 }}</span>
        <span>{{ PROVIDER_SHORT_LABELS[item.key] ?? item.key }}</span>
        <button
          v-if="!disabled"
          class="ml-0.5 h-4 w-4 flex items-center justify-center rounded-sm opacity-60 hover:opacity-100 hover:bg-white/20 transition-opacity"
          @click.stop="removeProvider(index)"
          @mousedown.stop
        >
          <X :size="12" :stroke-width="3" />
        </button>
      </div>
    </VueDraggable>

    <span v-if="localProviders.length === 0 && !disabled" class="text-xs text-muted-foreground/60 italic h-6 flex items-center px-1">
      {{ t('settings.metadata.fieldRules.dragProviderHere') }}
    </span>
  </div>
</template>

<style scoped>
.provider-chip-chosen {
  outline: 2px solid color-mix(in oklch, var(--primary) 55%, white);
  outline-offset: 1px;
}
</style>
