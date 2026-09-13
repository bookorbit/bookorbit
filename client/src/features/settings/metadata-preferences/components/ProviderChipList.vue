<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { VueDraggable } from 'vue-draggable-plus'
import { GripVertical, Slash, X } from '@lucide/vue'
import type { MetadataProviderKey, ProviderStatus } from '@bookorbit/types'
import { providerChipStyle, PROVIDER_SHORT_LABELS } from '@/lib/provider-colors'
import { PROVIDER_DND_GROUP, toProviderDragItems } from '../lib/provider-drag'
import { isProviderUsable, providerRank, skipReasonFor } from '../lib/field-rules'

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

/**
 * A chip carries its rank only when the provider will actually run. Skipped providers keep
 * their place in the order but show a slash, because numbering them implies a turn they
 * never take.
 */
const chips = computed(() =>
  localProviders.value.map((item, index) => {
    const status = statusFor(item.key)
    const skipReason = skipReasonFor(status)
    return {
      ...item,
      skipReason,
      rank: providerRank(
        localProviders.value.map((entry) => entry.key),
        index,
        props.statuses,
      ),
      label: status?.label ?? item.key,
      short: PROVIDER_SHORT_LABELS[item.key] ?? item.key,
      usable: isProviderUsable(item.key, props.statuses),
    }
  }),
)

function chipTitle(chip: (typeof chips.value)[number]) {
  if (!chip.skipReason) return chip.label
  return t(`settings.metadata.fieldRules.providerState.${chip.skipReason}Detail`, { provider: chip.label })
}

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
      class="flex min-h-[26px] flex-wrap items-center gap-1.5"
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
        v-for="(chip, index) in chips"
        :key="chip.dragId"
        :title="chipTitle(chip)"
        class="flex h-6 select-none items-center gap-1 rounded pl-1.5 pr-1 text-xs font-medium transition-transform"
        :class="[
          chip.usable ? 'provider-chip' : 'provider-chip-skipped',
          !disabled ? 'provider-chip-handle cursor-grab active:cursor-grabbing' : 'cursor-default',
        ]"
        :style="chip.usable ? providerChipStyle(chip.key) : undefined"
      >
        <GripVertical v-if="!disabled" :size="10" class="shrink-0 opacity-50" aria-hidden="true" />
        <Slash v-if="chip.skipReason" :size="10" class="shrink-0" aria-hidden="true" />
        <span v-else class="tabular-nums leading-none opacity-70">{{ chip.rank }}</span>
        <span>{{ chip.short }}</span>
        <span class="sr-only" v-if="chip.skipReason">{{ chipTitle(chip) }}</span>
        <button
          v-if="!disabled"
          type="button"
          :aria-label="t('settings.metadata.fieldRules.field.removeProvider', { provider: chip.label })"
          class="ml-0.5 flex h-4 w-4 items-center justify-center rounded-sm opacity-60 transition-opacity hover:bg-foreground/15 hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-current focus-visible:opacity-100"
          @click.stop="removeProvider(index)"
          @mousedown.stop
        >
          <X :size="12" :stroke-width="3" aria-hidden="true" />
        </button>
      </div>
    </VueDraggable>

    <span v-if="chips.length === 0" class="flex h-6 items-center px-1 text-xs text-muted-foreground">
      {{ t('settings.metadata.fieldRules.field.noProvidersYet') }}
    </span>
  </div>
</template>

<style scoped>
.provider-chip-chosen {
  outline: 2px solid color-mix(in oklch, var(--primary) 55%, white);
  outline-offset: 1px;
}
</style>
