<script setup lang="ts">
import type { Component } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import AppIcon from '@/components/AppIcon.vue'

withDefaults(
  defineProps<{
    isActive: boolean
    tooltip: string
    to: RouteLocationRaw
    icon: Component | string
    fallbackIcon?: Component | string
    label: string
    dataTour?: string
  }>(),
  { fallbackIcon: undefined, dataTour: undefined },
)

const emit = defineEmits<{ navigate: [] }>()

function handleNavigate() {
  emit('navigate')
}

const slots = defineSlots<{
  badge?: () => unknown
  trailing?: () => unknown
  extra?: () => unknown
}>()

const NAV_ICON_SIZE = 17

// 32px row: 2px accent bar at the left inset, tinted fill and primary label when active.
const buttonClass = [
  'group/item h-8 w-full min-w-0 gap-2 rounded-md px-2 font-medium',
  'before:absolute before:left-0 before:top-1/2 before:h-4 before:w-[2px] before:-translate-y-1/2 before:rounded-full before:bg-primary',
  'before:opacity-0 before:transition-opacity before:duration-150',
  'data-[active=true]:bg-(--shell-accent-tint) data-[active=true]:font-semibold data-[active=true]:before:opacity-100',
].join(' ')

// The grip sits out of flow, so a row only gives up right-edge space while one is rendered.
const trailingRoomClass = 'pr-6'
</script>

<template>
  <SidebarMenuItem>
    <SidebarMenuButton as-child :is-active="isActive" :tooltip="tooltip" :class="[buttonClass, slots.trailing ? trailingRoomClass : '']">
      <RouterLink :to="to" :data-tour="dataTour" @click="handleNavigate">
        <span class="inline-flex h-5 w-5 shrink-0 items-center justify-center">
          <component
            :is="icon"
            v-if="typeof icon !== 'string'"
            :size="NAV_ICON_SIZE"
            class="text-sidebar-foreground transition-colors duration-150 group-data-[active=true]/item:text-primary"
          />
          <AppIcon
            v-else
            :icon="icon"
            :fallback="fallbackIcon"
            :size="NAV_ICON_SIZE"
            class="text-sidebar-foreground transition-colors duration-150 group-data-[active=true]/item:text-primary"
          />
        </span>
        <span
          class="min-w-0 flex-1 truncate text-[14px] text-sidebar-foreground transition-colors duration-150 group-data-[active=true]/item:text-primary group-data-[collapsible=icon]:hidden"
        >
          {{ label }}
        </span>
        <slot name="badge" />
      </RouterLink>
    </SidebarMenuButton>
    <div v-if="slots.trailing" class="absolute right-1 top-0 flex h-8 items-center group-data-[collapsible=icon]:hidden">
      <slot name="trailing" />
    </div>
    <slot name="extra" />
  </SidebarMenuItem>
</template>
