<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  /** Text and audio positions sit at the same point, joined by a marker. */
  aligned: boolean
  muted?: boolean
}>()

const TRACK = 18
const textFill = computed(() => (props.aligned ? 11 : 13))
const audioFill = computed(() => (props.aligned ? 11 : 6))
const textClass = computed(() => (props.muted ? 'fill-muted-foreground' : 'fill-sync-meter-text'))
const audioClass = computed(() => (props.muted ? 'fill-muted-foreground' : 'fill-sync-meter-audio'))
</script>

<template>
  <svg :width="TRACK" height="14" :viewBox="`0 0 ${TRACK} 14`" aria-hidden="true" data-test="read-aloud-sync-meter" :data-aligned="aligned">
    <rect x="0" y="3" :width="TRACK" height="2.6" rx="1.3" class="fill-muted-foreground/35" />
    <rect x="0" y="8.4" :width="TRACK" height="2.6" rx="1.3" class="fill-muted-foreground/35" />
    <rect x="0" y="3" :width="textFill" height="2.6" rx="1.3" :class="textClass" />
    <rect x="0" y="8.4" :width="audioFill" height="2.6" rx="1.3" :class="audioClass" />
    <rect v-if="aligned" :x="textFill - 0.7" y="1" width="1.4" height="12" rx="0.7" class="fill-foreground" />
  </svg>
</template>
