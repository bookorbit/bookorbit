<script setup lang="ts">
import BookDetailHeader from './BookDetailHeader.vue'

defineProps<{ bookId: number }>()
</script>

<template>
  <div class="flex flex-col my-2 -ml-2 min-h-[calc(100%-1.5rem)] overflow-hidden rounded-xl border border-border/70 bg-card/60">
    <BookDetailHeader :book-id="bookId" />
    <main class="flex-1 overflow-y-auto overflow-x-hidden px-6 py-6">
      <slot />
    </main>
  </div>
</template>
