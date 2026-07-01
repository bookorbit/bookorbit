<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CustomMetadataFieldType } from '@bookorbit/types'

const { t } = useI18n()

defineProps<{ type: CustomMetadataFieldType }>()

const textValue = ref('')
const numberValue = ref('')
const dateValue = ref('')
const booleanValue = ref(false)

function toggleBoolean() {
  booleanValue.value = !booleanValue.value
}
</script>

<template>
  <div class="space-y-1">
    <span class="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-widest">{{
      t('settings.metadata.customFields.preview')
    }}</span>
    <input
      v-if="type === 'text' || type === 'url'"
      v-model="textValue"
      :type="type === 'url' ? 'url' : 'text'"
      :placeholder="type === 'url' ? 'https://example.com' : t('settings.metadata.customFields.sampleValue')"
      class="input-field w-full"
    />
    <input v-else-if="type === 'number'" v-model="numberValue" type="number" placeholder="0" class="input-field w-full" />
    <input v-else-if="type === 'date'" v-model="dateValue" type="date" class="input-field w-full" />
    <button
      v-else
      type="button"
      role="switch"
      :aria-checked="booleanValue"
      class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors"
      :class="booleanValue ? 'bg-primary' : 'bg-muted'"
      @click="toggleBoolean"
    >
      <span
        class="inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform"
        :class="booleanValue ? 'translate-x-5' : 'translate-x-0.5'"
      />
    </button>
  </div>
</template>
