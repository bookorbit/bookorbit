<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDownToLine, ArrowUpToLine, Check, Filter, Trash2 } from '@lucide/vue'
import type { FieldPreference, MetadataField, MetadataProviderKey, ProviderStatus } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { providerChipStyle, PROVIDER_SHORT_LABELS } from '@/lib/provider-colors'
import { providerUsageCount, skipReasonFor, type ProviderBulkAction } from '../lib/field-rules'

const { t } = useI18n()

const props = defineProps<{
  fields: Record<MetadataField, FieldPreference>
  statuses: ProviderStatus[]
  /** The provider the field list is filtered to, if any. */
  filter: MetadataProviderKey | null
  disabled?: boolean
}>()

const emit = defineEmits<{
  filterChange: [provider: MetadataProviderKey | null]
  bulk: [provider: MetadataProviderKey, action: ProviderBulkAction]
}>()

// Only providers that appear somewhere can be reordered or removed in bulk, so lead with
// those; the rest are still listed so a provider can be filtered on before it is used.
const entries = computed(() =>
  props.statuses
    .map((status) => {
      const key = status.key as MetadataProviderKey
      return {
        key,
        label: status.label,
        short: PROVIDER_SHORT_LABELS[key] ?? key,
        usage: providerUsageCount(props.fields, key),
        skipReason: skipReasonFor(status),
      }
    })
    .sort((a, b) => b.usage - a.usage || a.label.localeCompare(b.label)),
)

const activeLabel = computed(() => {
  if (!props.filter) return t('settings.metadata.fieldRules.toolbar.anyProvider')
  return props.statuses.find((status) => status.key === props.filter)?.label ?? props.filter
})

function setFilter(provider: MetadataProviderKey | null) {
  emit('filterChange', provider)
}

function clearFilter() {
  setFilter(null)
}

function runBulk(provider: MetadataProviderKey, action: ProviderBulkAction) {
  emit('bulk', provider, action)
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button variant="outline" size="sm" type="button" :disabled="disabled">
        <Filter :size="13" />
        <span class="text-muted-foreground">{{ t('settings.metadata.fieldRules.toolbar.provider') }}</span>
        <span class="max-w-32 truncate font-semibold">{{ activeLabel }}</span>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" class="w-72">
      <DropdownMenuLabel>{{ t('settings.metadata.fieldRules.toolbar.providerMenuTitle') }}</DropdownMenuLabel>
      <DropdownMenuItem @select="clearFilter">
        <Check :size="14" :class="filter ? 'opacity-0' : ''" />
        {{ t('settings.metadata.fieldRules.toolbar.anyProvider') }}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuSub v-for="entry in entries" :key="entry.key">
        <DropdownMenuSubTrigger>
          <span class="flex min-w-0 flex-1 items-center gap-2">
            <Check :size="14" :class="filter === entry.key ? '' : 'opacity-0'" />
            <span
              class="provider-chip inline-flex h-5 shrink-0 items-center rounded px-1.5 text-xs font-medium"
              :style="providerChipStyle(entry.key)"
            >
              {{ entry.short }}
            </span>
            <span class="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
              {{ t('settings.metadata.fieldRules.toolbar.usedIn', { count: entry.usage }) }}
            </span>
          </span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent class="w-64">
          <DropdownMenuItem @select="setFilter(entry.key)">
            <Filter :size="14" />
            {{ t('settings.metadata.fieldRules.toolbar.showOnlyThese') }}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel class="text-xs font-normal text-muted-foreground">
            {{ t('settings.metadata.fieldRules.toolbar.bulkLabel', { count: entry.usage }) }}
          </DropdownMenuLabel>
          <DropdownMenuItem :disabled="entry.usage === 0" @select="runBulk(entry.key, 'first')">
            <ArrowUpToLine :size="14" />
            {{ t('settings.metadata.fieldRules.toolbar.makeFirst') }}
          </DropdownMenuItem>
          <DropdownMenuItem :disabled="entry.usage === 0" @select="runBulk(entry.key, 'last')">
            <ArrowDownToLine :size="14" />
            {{ t('settings.metadata.fieldRules.toolbar.makeLast') }}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" :disabled="entry.usage === 0" @select="runBulk(entry.key, 'remove')">
            <Trash2 :size="14" />
            {{ t('settings.metadata.fieldRules.toolbar.removeEverywhere') }}
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
