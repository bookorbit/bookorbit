<script setup lang="ts">
import type { BookCoverDisplayMode } from '@bookorbit/types'
import { computed } from 'vue'
import { useDisplaySettings } from '@/composables/useDisplaySettings'

const props = withDefaults(
  defineProps<{
    size?: 'default' | 'mini'
    interactive?: boolean
    tag?: string
    disableSpine?: boolean
    isComic?: boolean
    displayMode?: BookCoverDisplayMode
  }>(),
  {
    size: 'default',
    interactive: false,
    tag: 'div',
    disableSpine: false,
    isComic: false,
    displayMode: undefined,
  },
)

const { bookSpineOverlay, bookShadowStrength, bookCoverDisplayMode, showSpineOnComics } = useDisplaySettings()

const spineOverlayMode = computed(() => {
  if (props.disableSpine) return 'off'
  if (props.isComic && !showSpineOnComics.value) return 'off'
  return bookSpineOverlay?.value ?? 'off'
})

const shadowStrengthMode = computed(() => bookShadowStrength?.value ?? 'default')
const coverDisplayMode = computed(() => props.displayMode ?? bookCoverDisplayMode?.value ?? 'blurred-fit')

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
    :data-cover-shadow="shadowStrengthMode"
    :data-cover-spine="spineOverlayMode"
    :data-cover-fit="coverDisplayMode"
    :data-cover-interactive="interactive ? 'true' : 'false'"
  >
    <slot />
  </component>
</template>
