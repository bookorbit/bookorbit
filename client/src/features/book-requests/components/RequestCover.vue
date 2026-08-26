<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { BookOpen, Headphones, Images } from '@lucide/vue'
import type { BookRequestMediaKind } from '@bookorbit/types'

const props = withDefaults(
  defineProps<{
    src: string | null
    fallbackSources?: string[]
    sourceKey?: string
    mediaKind: BookRequestMediaKind
    /** Sizing lives with the caller, because a table thumbnail and a page header differ. */
    class?: string
    iconSize?: number
  }>(),
  { class: '', iconSize: 18 },
)

const MEDIA_ICONS = { ebook: BookOpen, audiobook: Headphones, comic: Images } as const

/**
 * Cover URLs come from metadata providers, so they point at hosts BookOrbit does not control and
 * fail routinely. A bare `v-if="coverUrl"` only covers the null case: a URL that is present but
 * dead renders as a transparent gap where the cover should be, which reads as a broken row.
 */
const failedIndex = ref(0)

const emit = defineEmits<{
  sourceChange: [payload: { key: string | undefined; src: string | null }]
}>()

const sources = computed(() =>
  [props.src, ...(props.fallbackSources ?? [])]
    .filter((src): src is string => Boolean(src))
    .filter((src, index, values) => values.indexOf(src) === index),
)
const sourceSignature = computed(() => sources.value.join('\u0000'))

const currentSrc = computed(() => sources.value[failedIndex.value] ?? null)

watch(sourceSignature, () => {
  failedIndex.value = 0
})

watch(
  currentSrc,
  (src) => {
    emit('sourceChange', { key: props.sourceKey, src })
  },
  { immediate: true },
)

const showImage = computed(() => currentSrc.value !== null)
const icon = computed(() => MEDIA_ICONS[props.mediaKind] ?? BookOpen)

function handleError() {
  failedIndex.value += 1
}
</script>

<template>
  <img
    v-if="showImage"
    :src="currentSrc ?? undefined"
    alt=""
    class="shrink-0 rounded border border-border bg-muted object-cover"
    :class="props.class"
    loading="lazy"
    @error="handleError"
  />
  <div v-else class="flex shrink-0 items-center justify-center rounded border border-border bg-muted" :class="props.class" aria-hidden="true">
    <component :is="icon" :size="iconSize" class="text-muted-foreground" />
  </div>
</template>
