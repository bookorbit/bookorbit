<script setup lang="ts">
import { ref, watch } from 'vue'
import { BookOpen } from '@lucide/vue'

const props = withDefaults(
  defineProps<{
    src: string | null
    /** Sizing lives with the caller: a card and a list row differ. */
    class?: string
    iconSize?: number
  }>(),
  { class: '', iconSize: 18 },
)

/** A book without a cover, or one deleted since, answers the thumbnail with an error. */
const broken = ref(false)

watch(
  () => props.src,
  () => {
    broken.value = false
  },
)

function handleError() {
  broken.value = true
}
</script>

<template>
  <img
    v-if="src && !broken"
    :src="src"
    alt=""
    loading="lazy"
    class="shrink-0 rounded-md border border-border bg-muted object-cover"
    :class="props.class"
    @error="handleError"
  />
  <div v-else class="flex shrink-0 items-center justify-center rounded-md border border-border bg-muted" :class="props.class" aria-hidden="true">
    <BookOpen :size="iconSize" class="text-muted-foreground" />
  </div>
</template>
