<script setup lang="ts">
import { useId } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ReadAloudDeliveryPreference } from '@bookorbit/types'

const props = defineProps<{
  modelValue?: ReadAloudDeliveryPreference
  kindle?: boolean
  disabled?: boolean
  inheritLabel?: string
  explicitOnly?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: ReadAloudDeliveryPreference] }>()
const { t } = useI18n()
const id = useId()
function handleChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  emit('update:modelValue', value === 'original' ? 'original' : value === 'audioless_epub' ? 'audioless_epub' : null)
}
</script>

<template>
  <div class="min-w-0 space-y-1.5">
    <label :for="id" class="block text-sm font-medium text-foreground">{{ t('delivery.readAloud.label') }}</label>
    <select
      :id="id"
      :value="props.modelValue ?? ''"
      :disabled="disabled"
      :aria-describedby="`${id}-hint`"
      class="select-field w-full text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      @change="handleChange"
    >
      <option v-if="!explicitOnly" value="">{{ inheritLabel ?? t('delivery.readAloud.automatic') }}</option>
      <option value="audioless_epub">{{ t('delivery.readAloud.textOnly') }}</option>
      <option v-if="!kindle" value="original">{{ t('delivery.readAloud.original') }}</option>
    </select>
    <p :id="`${id}-hint`" class="text-xs text-muted-foreground">{{ t('delivery.readAloud.hint') }}</p>
  </div>
</template>
