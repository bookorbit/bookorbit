<script setup lang="ts">
import { ChevronLeft } from 'lucide-vue-next'
import { Skeleton } from '@/components/ui/skeleton'

defineProps<{ libraryName: string; loading: boolean }>()
defineEmits<{ back: [] }>()
</script>

<template>
  <button class="flex items-center gap-1 shrink-0 px-3 text-sm text-muted-foreground hover:text-foreground transition-colors" @click="$emit('back')">
    <ChevronLeft class="size-4" />
    <span v-if="!loading">{{ libraryName }}</span>
    <Skeleton v-else class="h-3.5 w-20 rounded" />
  </button>
  <div class="w-px h-4 bg-border mx-1 shrink-0" />
</template>
