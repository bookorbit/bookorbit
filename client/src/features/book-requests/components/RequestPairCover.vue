<script setup lang="ts">
import { computed } from 'vue'
import { Headphones } from '@lucide/vue'
import RequestCover from './RequestCover.vue'

/**
 * Both halves of a pair as one picture: the ebook's portrait cover, with the audiobook's square
 * art tucked into its lower corner. One glance says "this is both", and each half still shows the
 * shape it really has, so a square audiobook cover is never cropped into a portrait frame.
 *
 * When no audiobook art is known, or it is the same image as the ebook's, the corner carries a
 * headphones badge instead: the same picture twice says nothing the first one did not.
 */
const props = withDefaults(
  defineProps<{
    ebookSrc: string | null
    audioSrc: string | null
    ebookFallbacks?: string[]
    audioFallbacks?: string[]
    sourceKey?: string
    /** Sizing for the portrait frame lives with the caller, like `RequestCover`. */
    class?: string
    iconSize?: number
  }>(),
  { ebookFallbacks: () => [], audioFallbacks: () => [], class: '', iconSize: 18 },
)

const emit = defineEmits<{
  sourceChange: [payload: { key: string | undefined; src: string | null }]
}>()

const distinctAudioArt = computed(() => props.audioSrc !== null && props.audioSrc !== props.ebookSrc)
const insetIconSize = computed(() => Math.max(9, Math.round(props.iconSize * 0.6)))

function handleSourceChange(payload: { key: string | undefined; src: string | null }) {
  emit('sourceChange', payload)
}
</script>

<template>
  <div class="relative shrink-0" :class="props.class">
    <RequestCover
      :src="ebookSrc"
      :fallback-sources="ebookFallbacks"
      :source-key="sourceKey"
      media-kind="ebook"
      class="h-full w-full"
      :icon-size="iconSize"
      @source-change="handleSourceChange"
    />
    <!-- The card colour as a ring, so the inset reads as a second object on any cover art. -->
    <RequestCover
      v-if="distinctAudioArt"
      :src="audioSrc"
      :fallback-sources="audioFallbacks"
      :source-key="sourceKey === undefined ? undefined : `${sourceKey}|audio`"
      media-kind="audiobook"
      class="absolute -end-1.5 -bottom-1.5 aspect-square w-[58%] shadow-sm ring-2 ring-card"
      :icon-size="insetIconSize"
      @source-change="handleSourceChange"
    />
    <span
      v-else
      class="absolute -end-1.5 -bottom-1.5 flex aspect-square w-[46%] items-center justify-center rounded-full border border-border bg-muted text-muted-foreground shadow-sm ring-2 ring-card"
      aria-hidden="true"
    >
      <Headphones :size="insetIconSize" />
    </span>
  </div>
</template>
