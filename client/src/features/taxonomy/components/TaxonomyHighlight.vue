<script setup lang="ts">
import { computed } from 'vue'
import { highlightSegments } from '../lib/taxonomy-text'

/** A name with the part that matched the search marked, ignoring case and accents. */
const props = defineProps<{ name: string; query?: string }>()

const segments = computed(() => highlightSegments(props.name, props.query ?? ''))
</script>

<template>
  <template v-for="(segment, index) in segments" :key="index">
    <mark v-if="segment.match" class="rounded-[2px] bg-primary/24 text-inherit">{{ segment.text }}</mark>
    <template v-else>{{ segment.text }}</template>
  </template>
</template>
