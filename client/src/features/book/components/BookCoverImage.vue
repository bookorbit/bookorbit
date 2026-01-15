<script setup lang="ts">
const props = defineProps<{
  bookId: number
  type?: 'thumbnail' | 'cover'
  class?: string
  alt?: string
}>()
</script>

<template>
  <img :src="`/api/books/${props.bookId}/${props.type ?? 'thumbnail'}`" :class="props.class" :alt="props.alt ?? ''" loading="lazy" />
</template>
