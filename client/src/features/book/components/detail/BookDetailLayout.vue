<script setup lang="ts">
import BookDetailHeader from './BookDetailHeader.vue'
import { coverTintVars, type CoverTint } from '@/features/book/lib/cover-tint'
import { computed } from 'vue'

const props = withDefaults(defineProps<{ bookId: number; canEditMetadata?: boolean; coverTint?: CoverTint | null }>(), { coverTint: null })

const tintVars = computed(() => coverTintVars(props.coverTint))
</script>

<template>
  <div
    :class="[
      'flex flex-col mt-2 mb-0 h-[calc(100%-0.5rem)] overflow-hidden rounded-lg border border-border/70 bg-card/60 shadow-sm',
      coverTint ? 'book-detail-cover-tint' : '',
    ]"
    :style="tintVars"
  >
    <BookDetailHeader :book-id="bookId" :can-edit-metadata="canEditMetadata" />
    <main class="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:px-6 sm:py-4">
      <slot />
    </main>
  </div>
</template>
