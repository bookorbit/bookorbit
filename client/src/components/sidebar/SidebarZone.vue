<script setup lang="ts">
import { SidebarGroup, SidebarGroupContent, SidebarMenu } from '@/components/ui/sidebar'

defineProps<{ label?: string | null }>()
</script>

<template>
  <SidebarGroup>
    <p
      v-if="label"
      class="mb-0.5 px-2 pt-1.5 pb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground group-data-[collapsible=icon]:hidden"
    >
      {{ label }}
    </p>
    <SidebarGroupContent>
      <SidebarMenu>
        <slot />
      </SidebarMenu>
    </SidebarGroupContent>
  </SidebarGroup>
</template>
