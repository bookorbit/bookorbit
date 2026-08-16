<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, RotateCcw, Settings2 } from '@lucide/vue'
import type { FieldPreference, MetadataField, ProviderStatus } from '@bookorbit/types'
import MergeStrategyPicker from './MergeStrategyPicker.vue'
import ProviderChipList from './ProviderChipList.vue'
import FieldConfigSheet from './FieldConfigSheet.vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'

const { t } = useI18n()

const props = defineProps<{
  field: MetadataField
  preference: FieldPreference
  statuses: ProviderStatus[]
  inherited?: boolean
  saving?: boolean
}>()

const emit = defineEmits<{
  change: [field: MetadataField, pref: FieldPreference]
  revert: [field: MetadataField]
}>()

const label = computed(() => t(`settings.metadata.fields.${props.field}`))
const noProviders = computed(() => props.preference.enabled && props.preference.providers.length === 0)
const sheetOpen = ref(false)

function update(patch: Partial<FieldPreference>) {
  emit('change', props.field, { ...props.preference, ...patch })
}

function onSheetChange(pref: FieldPreference) {
  emit('change', props.field, pref)
}

function openSheet() {
  sheetOpen.value = true
}

function revertPreference() {
  emit('revert', props.field)
}
</script>

<template>
  <div class="flex flex-col md:flex-row md:items-center gap-4 px-6 py-3.5 transition-colors relative hover:bg-muted/15">
    <!-- Enable toggle + label -->
    <div class="flex items-center gap-3 md:w-44 shrink-0">
      <div
        class="relative flex h-4.5 w-8.5 shrink-0 items-center rounded-full transition-colors cursor-pointer"
        :class="preference.enabled ? 'bg-primary' : 'bg-muted border border-border'"
        @click="update({ enabled: !preference.enabled })"
      >
        <span
          class="inline-block h-3.5 w-3.5 rounded-full bg-white shadow-xs transition-transform"
          :class="preference.enabled ? 'translate-x-4' : 'translate-x-0.5'"
        />
      </div>
      <span class="settings-label truncate">{{ label }}</span>
    </div>

    <!-- Provider chip list (desktop) -->
    <div class="flex-1 min-w-0 hidden md:block">
      <div class="flex items-center gap-2">
        <ProviderChipList
          :providers="preference.providers"
          :statuses="statuses"
          :disabled="!preference.enabled || saving"
          @update:providers="update({ providers: $event })"
        />
        <Tooltip v-if="noProviders">
          <TooltipTrigger as-child>
            <AlertTriangle :size="14" class="text-amber-500 animate-pulse shrink-0" />
          </TooltipTrigger>
          <TooltipContent>{{ t('settings.metadata.fieldRules.field.noProviders') }}</TooltipContent>
        </Tooltip>
      </div>
    </div>

    <!-- Mobile: draggable chips + configure button -->
    <div class="flex items-center gap-3 md:hidden">
      <div class="flex-1 min-w-0">
        <ProviderChipList
          :providers="preference.providers"
          :statuses="statuses"
          :disabled="!preference.enabled || saving"
          @update:providers="update({ providers: $event })"
        />
        <span v-if="noProviders" class="flex items-center gap-1.5 text-xs text-amber-500 font-bold uppercase tracking-tight">
          <AlertTriangle :size="12" />
          {{ t('settings.metadata.fieldRules.field.empty') }}
        </span>
      </div>
      <Button variant="outline" size="sm" :disabled="saving" class="shrink-0" @click="openSheet">
        <Settings2 :size="13" />
        {{ t('settings.metadata.fieldRules.field.config') }}
      </Button>
    </div>

    <!-- Merge strategy + badges + revert (desktop) -->
    <div class="hidden md:flex items-center gap-4 shrink-0">
      <div class="w-44 shrink-0">
        <MergeStrategyPicker
          :model-value="preference.mergeStrategy"
          :disabled="!preference.enabled || saving"
          @update:model-value="update({ mergeStrategy: $event })"
        />
      </div>

      <div v-if="inherited !== undefined" class="w-16 flex items-center justify-center shrink-0">
        <Tooltip v-if="!inherited">
          <TooltipTrigger as-child>
            <div class="flex items-center gap-1">
              <Badge variant="secondary" class="h-4.5 px-1.5 text-[9px] font-bold uppercase tracking-tight">
                {{ t('settings.metadata.fieldRules.field.custom') }}
              </Badge>
              <Button variant="destructive-ghost" size="icon-sm" :disabled="saving" @click="revertPreference">
                <RotateCcw :size="11" />
              </Button>
            </div>
          </TooltipTrigger>
          <TooltipContent>{{ t('settings.metadata.fieldRules.field.resetToDefault') }}</TooltipContent>
        </Tooltip>
        <Badge v-else variant="outline" class="h-4.5 px-1.5 text-[9px] font-bold uppercase tracking-tight opacity-40">
          {{ t('settings.metadata.fieldRules.field.default') }}
        </Badge>
      </div>
    </div>

    <FieldConfigSheet
      v-if="sheetOpen"
      :field="field"
      :preference="preference"
      :statuses="statuses"
      @change="onSheetChange"
      @close="sheetOpen = false"
    />
  </div>
</template>
