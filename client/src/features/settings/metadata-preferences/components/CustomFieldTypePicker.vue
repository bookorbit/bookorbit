<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Check, Lock } from '@lucide/vue'
import type { CustomMetadataFieldType } from '@bookorbit/types'
import { CUSTOM_FIELD_TYPE_ORDER, typeHintKey, typeLabelKey } from '../lib/custom-field-types'
import CustomFieldTypeTile from './CustomFieldTypeTile.vue'

/** Native radios behind the cards, so arrow keys move between types as in any radio group. */
defineProps<{ modelValue: CustomMetadataFieldType; name: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: CustomMetadataFieldType] }>()

const { t } = useI18n()

function select(type: CustomMetadataFieldType) {
  emit('update:modelValue', type)
}
</script>

<template>
  <fieldset class="space-y-2">
    <legend class="settings-label mb-2">{{ t('settings.metadata.customFields.type') }}</legend>
    <div class="grid grid-cols-2 gap-2 sm:grid-cols-5">
      <label
        v-for="type in CUSTOM_FIELD_TYPE_ORDER"
        :key="type"
        class="relative flex min-w-0 cursor-pointer flex-col gap-2 rounded-[10px] border bg-card px-3 py-2.5 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
        :class="modelValue === type ? 'border-primary/70 bg-primary/7' : 'border-border hover:border-foreground/22'"
      >
        <input type="radio" class="sr-only" :name="name" :value="type" :checked="modelValue === type" @change="select(type)" />
        <CustomFieldTypeTile :type="type" :size="28" />
        <span class="block">
          <span class="block text-[13px] font-semibold text-foreground">{{ t(typeLabelKey(type)) }}</span>
          <span class="mt-0.5 block text-[11.5px] leading-[15px] text-muted-foreground">{{ t(typeHintKey(type)) }}</span>
        </span>
        <span
          v-if="modelValue === type"
          class="absolute end-2 top-2 grid size-4 place-items-center rounded-full bg-primary text-primary-foreground"
          aria-hidden="true"
        >
          <Check :size="11" :stroke-width="3" />
        </span>
      </label>
    </div>
    <p class="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Lock :size="12" aria-hidden="true" />
      {{ t('settings.metadata.customFields.sheet.typeLockedHint') }}
    </p>
  </fieldset>
</template>
