<script setup lang="ts">
import { computed } from 'vue'
import type { CustomMetadataFieldType } from '@bookorbit/types'
import { CUSTOM_FIELD_TYPE_META, typeTintStyle } from '../lib/custom-field-types'

const props = withDefaults(defineProps<{ type: CustomMetadataFieldType; size?: number }>(), { size: 28 })

const style = computed(() => ({
  ...typeTintStyle(props.type, 12, 28),
  width: `${props.size}px`,
  height: `${props.size}px`,
  borderRadius: `${Math.round(props.size * 0.24)}px`,
}))
</script>

<template>
  <span class="inline-grid shrink-0 place-items-center" :style="style" aria-hidden="true">
    <component :is="CUSTOM_FIELD_TYPE_META[type].icon" :size="Math.round(size * 0.5)" :stroke-width="2.1" />
  </span>
</template>
