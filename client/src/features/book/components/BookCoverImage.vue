<script setup lang="ts">
import { onMounted } from 'vue'
import { useBookCover } from '../composables/useBookCover'

const props = defineProps<{
  bookId: number
  type?: 'thumbnail' | 'cover'
  class?: string
  alt?: string
}>()

const { src, failed, load } = useBookCover(props.bookId, props.type ?? 'thumbnail')

onMounted(load)
</script>

<template>
  <img v-if="src && !failed" :src="src" :class="props.class" :alt="props.alt ?? ''" />
  <div v-else :class="props.class" class="bg-muted" />
</template>
