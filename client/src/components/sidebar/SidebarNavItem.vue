<script setup lang="ts">
import type { Component } from 'vue'
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'

withDefaults(
  defineProps<{
    isActive: boolean
    tooltip: string
    icon: Component
    iconSize?: number
    iconClass?: string
    label: string
  }>(),
  { iconSize: 16, iconClass: '' },
)

const emit = defineEmits<{ click: [] }>()
</script>

<template>
  <SidebarMenuItem>
    <SidebarMenuButton
      :is-active="isActive"
      :tooltip="tooltip"
      class="relative h-8.5 gap-1 rounded-xl pl-0.5 pr-2 transition-[background-color,box-shadow] duration-200 before:absolute before:-left-1 before:top-1/2 before:h-4 before:w-[2.5px] before:-translate-y-1/2 before:scale-y-75 before:rounded-full before:bg-primary before:opacity-0 before:transition-all before:duration-200 hover:bg-primary/8 data-[active=true]:bg-primary/12 data-[active=true]:shadow-[inset_0_0_0_1px_var(--sidebar-border)] data-[active=true]:before:scale-y-100 data-[active=true]:before:opacity-100 group/item group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-1.5"
      @click="emit('click')"
    >
      <span class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors">
        <component
          :is="icon"
          :size="iconSize"
          class="text-sidebar-foreground/70 transition-colors group-hover/item:text-sidebar-foreground group-data-[active=true]/item:text-primary"
          :class="iconClass"
        />
      </span>
      <span
        class="text-sm font-medium tracking-tight text-sidebar-foreground/90 transition-colors group-hover/item:text-sidebar-foreground group-data-[active=true]/item:text-primary group-data-[collapsible=icon]:hidden"
      >
        {{ label }}
      </span>
      <slot name="badge" />
    </SidebarMenuButton>
    <slot name="extra" />
  </SidebarMenuItem>
</template>
