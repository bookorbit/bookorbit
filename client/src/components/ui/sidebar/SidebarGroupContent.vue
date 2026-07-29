<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <div data-slot="sidebar-group-content" data-sidebar="group-content" :class="cn('w-full text-[14px]', props.class)">
    <slot />
  </div>
</template>
