<script setup lang="ts">
import { computed } from 'vue'
import { useDisplaySettings } from '@/composables/useDisplaySettings'

const props = withDefaults(
  defineProps<{
    size?: 'default' | 'mini'
    interactive?: boolean
    tag?: string
  }>(),
  {
    size: 'default',
    interactive: false,
    tag: 'div',
  },
)

const { bookSpineOverlay, bookShadowStrength } = useDisplaySettings()

const classes = computed(() => [
  'book-cover-surface',
  props.size === 'mini' ? 'book-cover-surface--mini' : '',
  props.interactive ? 'book-cover-surface--interactive' : '',
])
</script>

<template>
  <component
    :is="tag"
    :class="classes"
    :data-cover-size="size"
    :data-cover-shadow="bookShadowStrength"
    :data-cover-spine="bookSpineOverlay"
    :data-cover-interactive="interactive ? 'true' : 'false'"
  >
    <slot />
  </component>
</template>
