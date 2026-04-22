<script setup lang="ts">
import BookDetailHeader from './BookDetailHeader.vue'

defineProps<{ bookId: number }>()
</script>

<template>
  <div class="flex flex-col mt-2 mb-0 h-[calc(100%-0.5rem)] overflow-hidden rounded-lg border border-border/70 bg-card/60 shadow-sm">
    <BookDetailHeader :book-id="bookId" />
    <main class="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6">
      <slot />
    </main>
  </div>
</template>
