<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { icuCountValues, splitIcuCount } from '@/i18n/icu'

const props = defineProps<{
  count: number
  keypath: string
}>()

defineSlots<{
  count(props: { value: string }): unknown
}>()

const { t } = useI18n()
const parts = computed(() => splitIcuCount(t(props.keypath, icuCountValues(props.count))))
</script>

<template>
  <template v-for="(part, index) in parts" :key="index">
    <slot v-if="part.isCount" name="count" :value="part.value">{{ part.value }}</slot>
    <template v-else>{{ part.value }}</template>
  </template>
</template>
