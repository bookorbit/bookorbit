<script setup lang="ts">
import { ref, watch } from 'vue'
import { Radio } from '@lucide/vue'

/**
 * Cover art with its fallback. A remote image can 404 long after the row rendered, and a recycled
 * row must not inherit the previous show's failure, so the failed flag is owned here and cleared
 * whenever the subject changes. `resetKey` covers the case where the URL stays the same but the
 * image behind it does not, such as an artwork replacement.
 */
const props = withDefaults(
  defineProps<{
    src: string | null | undefined
    resetKey?: string | number | null
    /** Extra classes for the image itself, for hover transforms and the like. */
    imageClass?: string
    iconClass?: string
    /** Feeds have no useful alt text; a title beside the image already names it. */
    alt?: string
  }>(),
  { resetKey: null, imageClass: '', iconClass: 'size-6', alt: '' },
)

const failed = ref(false)

watch([() => props.src, () => props.resetKey], () => {
  failed.value = false
})

function handleError() {
  failed.value = true
}
</script>

<template>
  <span class="block overflow-hidden bg-muted">
    <img v-if="src && !failed" :src="src" :alt="alt" class="h-full w-full object-cover" :class="imageClass" @error="handleError" />
    <span v-else class="flex h-full w-full items-center justify-center">
      <Radio class="text-muted-foreground" :class="iconClass" aria-hidden="true" />
    </span>
  </span>
</template>
