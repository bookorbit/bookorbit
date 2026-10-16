<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CustomMetadataFieldType } from '@bookorbit/types'
import { CUSTOM_FIELD_TYPE_META, typeLabelKey, typeTintStyle } from '../lib/custom-field-types'

const props = withDefaults(defineProps<{ type: CustomMetadataFieldType; size?: 'md' | 'sm' }>(), { size: 'md' })

const { t } = useI18n()

const style = computed(() => typeTintStyle(props.type))
</script>

<template>
  <span
    class="inline-flex shrink-0 items-center rounded-full font-semibold whitespace-nowrap"
    :class="size === 'sm' ? 'h-5 gap-1 ps-1.5 pe-2 text-[11px]' : 'h-[22px] gap-1.5 ps-2 pe-2.5 text-[11.5px]'"
    :style="style"
  >
    <component :is="CUSTOM_FIELD_TYPE_META[type].icon" :size="size === 'sm' ? 11 : 12" :stroke-width="2.25" aria-hidden="true" />
    {{ t(typeLabelKey(type)) }}
  </span>
</template>
