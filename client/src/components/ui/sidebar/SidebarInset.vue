<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <main
    data-slot="sidebar-inset"
    :class="
      cn(
        'relative flex w-full flex-1 flex-col',
        // Sidebar variant: padding-left replaces the old spacer div, letting the background extend under the sidebar for glass effect
        'md:peer-data-[variant=sidebar]:pl-(--sidebar-width)',
        'md:peer-data-[variant=sidebar]:peer-data-[collapsible=offcanvas]:pl-0',
        'md:peer-data-[variant=sidebar]:peer-data-[collapsible=icon]:pl-(--sidebar-width-icon)',
        'md:peer-data-[variant=sidebar]:transition-[padding-left] md:peer-data-[variant=sidebar]:duration-200 md:peer-data-[variant=sidebar]:ease-linear',
        // Floating variant: align with the sidebar container's edge
        'md:peer-data-[variant=floating]:pl-(--sidebar-width)',
        'md:peer-data-[variant=floating]:peer-data-[collapsible=icon]:pl-[calc(var(--sidebar-width-icon)+(--spacing(6))+2px)]',
        'md:peer-data-[variant=floating]:transition-[padding-left] md:peer-data-[variant=floating]:duration-200 md:peer-data-[variant=floating]:ease-linear',
        // Inset variant: existing margin-based layout unchanged
        'md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow-sm md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-2',
        props.class,
      )
    "
  >
    <slot />
  </main>
</template>
