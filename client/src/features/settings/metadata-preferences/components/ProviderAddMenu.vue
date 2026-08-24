<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus } from '@lucide/vue'
import type { MetadataProviderKey, ProviderStatus } from '@bookorbit/types'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { providerChipStyle, PROVIDER_SHORT_LABELS } from '@/lib/provider-colors'
import { skipReasonFor } from '../lib/field-rules'

const { t } = useI18n()

const props = defineProps<{
  assigned: MetadataProviderKey[]
  statuses: ProviderStatus[]
  disabled?: boolean
  /** Rendered in the trigger and used as its accessible name. */
  fieldLabel: string
}>()

const emit = defineEmits<{ add: [provider: MetadataProviderKey] }>()

const open = ref(false)

// Usable providers first: an unconfigured one can still be added, but it is not the
// choice anyone is looking for.
const candidates = computed(() => {
  const available = props.statuses.filter((status) => !props.assigned.includes(status.key as MetadataProviderKey))
  return available
    .map((status) => ({
      key: status.key as MetadataProviderKey,
      label: status.label,
      short: PROVIDER_SHORT_LABELS[status.key] ?? status.key,
      skipReason: skipReasonFor(status),
    }))
    .sort((a, b) => Number(Boolean(a.skipReason)) - Number(Boolean(b.skipReason)))
})

function add(provider: MetadataProviderKey) {
  emit('add', provider)
  open.value = false
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger
      type="button"
      :disabled="disabled || candidates.length === 0"
      :aria-label="t('settings.metadata.fieldRules.field.addProviderTo', { field: fieldLabel })"
      class="inline-flex h-6 shrink-0 items-center gap-1 rounded border border-dashed border-input px-2 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Plus :size="12" :stroke-width="3" aria-hidden="true" />
      {{ t('settings.metadata.fieldRules.field.add') }}
    </PopoverTrigger>
    <PopoverContent align="start" class="w-64 p-1.5">
      <p class="px-2 pb-1.5 pt-1 text-xs text-muted-foreground">
        {{ t('settings.metadata.fieldRules.field.addHint') }}
      </p>
      <div class="max-h-64 overflow-y-auto">
        <button
          v-for="candidate in candidates"
          :key="candidate.key"
          type="button"
          class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
          @click="add(candidate.key)"
        >
          <span class="provider-chip inline-flex h-5 items-center rounded px-1.5 text-xs font-medium" :style="providerChipStyle(candidate.key)">
            {{ candidate.short }}
          </span>
          <span v-if="candidate.skipReason" class="ml-auto text-xs text-muted-foreground">
            {{ t(`settings.metadata.fieldRules.providerState.${candidate.skipReason}`) }}
          </span>
        </button>
      </div>
    </PopoverContent>
  </Popover>
</template>
