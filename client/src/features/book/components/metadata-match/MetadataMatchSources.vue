<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, ChevronDown, Loader2, TriangleAlert } from '@lucide/vue'
import type { MetadataProviderInfo, MetadataProviderKey, MetadataProviderSearchOutcome } from '@bookorbit/types'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatList } from '@/i18n/formatters'
import { getProviderColor, providerActivePillStyle } from '../../lib/metadata-fetch'

const props = defineProps<{
  providers: MetadataProviderInfo[]
  selectedProviders: MetadataProviderKey[]
  providerCounts: Partial<Record<MetadataProviderKey, number>>
  interruptedProviders: { provider: MetadataProviderKey; outcome: MetadataProviderSearchOutcome }[]
  retryingProviders: MetadataProviderKey[]
  isStreaming: boolean
}>()

const emit = defineEmits<{
  toggle: [MetadataProviderKey]
  selectAll: []
  selectFieldRules: []
}>()

const { t } = useI18n()

const allKeys = computed(() => props.providers.map((provider) => provider.key))
const ruleKeys = computed(() => props.providers.filter((provider) => provider.selectedByFieldRules).map((provider) => provider.key))
const outside = computed(() => props.providers.filter((provider) => provider.selectedByFieldRules === false))
const hasRuleScope = computed(() => outside.value.length > 0 && ruleKeys.value.length > 0)
const outsideOn = computed(() => outside.value.filter((provider) => props.selectedProviders.includes(provider.key)))
const outsideNames = computed(() => formatList(outside.value.map((provider) => provider.label)))

function sameSelection(keys: MetadataProviderKey[]): boolean {
  if (!keys.length) return false
  const selected = new Set(props.selectedProviders)
  return selected.size === keys.length && keys.every((key) => selected.has(key))
}

const scope = computed<'all' | 'rules' | 'custom'>(() => {
  if (sameSelection(allKeys.value)) return 'all'
  if (hasRuleScope.value && sameSelection(ruleKeys.value)) return 'rules'
  return 'custom'
})
const scopeLabel = computed(() => {
  if (scope.value === 'all') return t('book.detail.editMetadata.searchPanel.allEnabled')
  if (scope.value === 'rules') return t('book.detail.editMetadata.searchPanel.fieldRules')
  return t('book.detail.editMetadata.searchPanel.custom')
})

const stoppedProviders = computed(() => new Set(props.interruptedProviders.map((entry) => entry.provider)))

function isOn(key: MetadataProviderKey): boolean {
  return props.selectedProviders.includes(key)
}

function statusOf(provider: MetadataProviderInfo): 'searching' | 'stopped' | 'done' {
  if (props.retryingProviders.includes(provider.key)) return 'searching'
  if (stoppedProviders.value.has(provider.key)) return 'stopped'
  if (props.isStreaming && isOn(provider.key) && !props.providerCounts[provider.key]) return 'searching'
  return 'done'
}

function chipLabel(provider: MetadataProviderInfo): string {
  const status = statusOf(provider)
  if (status === 'searching') return t('book.detail.editMetadata.match.sources.searching', { provider: provider.label })
  if (status === 'stopped') return t('book.detail.editMetadata.match.sources.stopped', { provider: provider.label })
  return t('book.detail.editMetadata.match.sources.count', { provider: provider.label, count: props.providerCounts[provider.key] ?? 0 })
}

function chipStyle(key: MetadataProviderKey): Record<string, string> {
  return isOn(key) ? providerActivePillStyle(key) : {}
}

function dotStyle(key: MetadataProviderKey): Record<string, string> {
  return isOn(key) ? { backgroundColor: getProviderColor(key) } : {}
}

function handleToggle(key: MetadataProviderKey) {
  emit('toggle', key)
}

function handleSelectAll() {
  emit('selectAll')
}

function handleSelectFieldRules() {
  emit('selectFieldRules')
}
</script>

<template>
  <div class="grid gap-2">
    <div class="flex items-center justify-between gap-2">
      <h3 class="text-[10.5px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
        {{ t('book.detail.editMetadata.match.sources.heading') }}
      </h3>
      <Popover>
        <PopoverTrigger as-child>
          <button
            type="button"
            class="-mx-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-xs font-medium text-foreground hover:bg-muted"
            :aria-label="`${t('book.detail.editMetadata.searchPanel.searchScope')}: ${scopeLabel}`"
          >
            {{ scopeLabel }}<ChevronDown class="size-3" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" class="w-72 p-1.5">
          <div role="group" :aria-label="t('book.detail.editMetadata.searchPanel.searchScope')" class="grid gap-0.5">
            <button
              type="button"
              class="grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-2 rounded-md px-2 py-1.5 text-start text-[12.5px] hover:bg-muted"
              :aria-pressed="scope === 'all'"
              @click="handleSelectAll"
            >
              <Check class="mt-0.5 size-3.5 text-primary" :class="scope === 'all' ? '' : 'invisible'" aria-hidden="true" />
              <span>
                {{ t('book.detail.editMetadata.searchPanel.allEnabled') }}
                <span class="block text-[11.5px] text-muted-foreground">{{
                  t('book.detail.editMetadata.match.sources.allEnabledHint', { count: allKeys.length })
                }}</span>
              </span>
            </button>
            <button
              v-if="hasRuleScope"
              type="button"
              class="grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-2 rounded-md px-2 py-1.5 text-start text-[12.5px] hover:bg-muted"
              :aria-pressed="scope === 'rules'"
              @click="handleSelectFieldRules"
            >
              <Check class="mt-0.5 size-3.5 text-primary" :class="scope === 'rules' ? '' : 'invisible'" aria-hidden="true" />
              <span>
                {{ t('book.detail.editMetadata.searchPanel.fieldRules') }}
                <span class="block text-[11.5px] text-muted-foreground">{{
                  t('book.detail.editMetadata.match.sources.fieldRulesHint', { count: ruleKeys.length })
                }}</span>
              </span>
            </button>
          </div>
          <template v-if="outside.length">
            <div class="mx-0.5 my-1.5 h-px bg-border" />
            <p class="px-2 pt-0.5 pb-1 text-[11.5px] leading-snug text-muted-foreground">
              {{ t('book.detail.editMetadata.match.sources.outsideRules', { providers: outsideNames, count: outside.length }) }}
            </p>
          </template>
        </PopoverContent>
      </Popover>
    </div>

    <div class="flex flex-wrap gap-1.5" role="group" :aria-label="t('book.detail.editMetadata.match.sources.heading')">
      <button
        v-for="provider in providers"
        :key="provider.key"
        type="button"
        class="inline-flex h-[26px] items-center gap-1.5 rounded-full border ps-2.5 pe-1.5 text-xs font-medium transition-colors"
        :class="[
          isOn(provider.key) ? 'border-transparent' : 'border-border text-foreground hover:bg-muted',
          provider.selectedByFieldRules === false ? 'border-dashed' : '',
        ]"
        :style="chipStyle(provider.key)"
        :aria-pressed="isOn(provider.key)"
        :aria-label="chipLabel(provider)"
        :title="
          provider.selectedByFieldRules === false
            ? t('book.detail.editMetadata.searchPanel.providerNotInFieldRules', { provider: provider.label })
            : undefined
        "
        @click="handleToggle(provider.key)"
      >
        <span
          class="size-[7px] shrink-0 rounded-full"
          :class="isOn(provider.key) ? '' : 'ring-[1.5px] ring-muted-foreground ring-inset'"
          :style="dotStyle(provider.key)"
        />
        {{ provider.label }}
        <Loader2 v-if="statusOf(provider) === 'searching'" class="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        <span v-else-if="statusOf(provider) === 'stopped'" class="grid size-[18px] place-items-center rounded-full bg-warning/20 text-warning">
          <TriangleAlert class="size-2.5" aria-hidden="true" />
        </span>
        <span v-else class="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-current/15 px-1 text-[10.5px] font-bold tabular-nums">
          <span class="text-foreground">{{ providerCounts[provider.key] ?? 0 }}</span>
        </span>
      </button>
    </div>

    <p v-if="outsideOn.length" class="text-[11.5px] leading-snug text-muted-foreground">
      {{ t('book.detail.editMetadata.match.sources.manualOnly', { providers: formatList(outsideOn.map((provider) => provider.label)) }) }}
    </p>
  </div>
</template>
