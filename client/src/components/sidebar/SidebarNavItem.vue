<script setup lang="ts">
import { computed, h, useId, type Component } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import AppIcon from '@/components/AppIcon.vue'
import SidebarNavTooltip from '@/components/sidebar/SidebarNavTooltip.vue'
import type { SidebarNavSignal } from '@/composables/useSidebarNav'

const props = withDefaults(
  defineProps<{
    isActive: boolean
    tooltip: string
    to: RouteLocationRaw
    icon: Component | string
    fallbackIcon?: Component | string
    label: string
    dataTour?: string
    signal?: SidebarNavSignal | null
  }>(),
  { fallbackIcon: undefined, dataTour: undefined, signal: null },
)

const descriptionId = useId()

/** An entry with live details shows them on hover in the expanded sidebar too, where the row has no room for them. */
const tooltipContent = computed<string | Component>(() => {
  const details = props.signal?.details ?? []
  if (details.length === 0) return props.tooltip
  return () => h(SidebarNavTooltip, { label: props.label, lines: details })
})
const activity = computed(() => props.signal?.activity ?? undefined)

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

// 28px row: 2px accent bar at the left inset, tinted fill and primary label when active.
const buttonClass = [
  'group/item h-7 w-full min-w-0 gap-2 rounded-md px-2 font-normal',
  'before:absolute before:left-0 before:top-1/2 before:h-4 before:w-[2px] before:-translate-y-1/2 before:rounded-full before:bg-primary',
  'before:opacity-0 before:transition-opacity before:duration-150',
  'data-[active=true]:bg-(--sidebar-active-bg) data-[active=true]:[font-weight:var(--sidebar-active-weight)] data-[active=true]:before:opacity-100',
].join(' ')

// The grip sits out of flow, so a row only gives up right-edge space while one is rendered.
const trailingRoomClass = 'pr-6'
</script>

<template>
  <SidebarMenuItem>
    <SidebarMenuButton
      as-child
      :is-active="isActive"
      :tooltip="tooltipContent"
      :tooltip-when-expanded="signal !== null && signal.details.length > 0"
      :class="[buttonClass, slots.trailing ? trailingRoomClass : '']"
    >
      <RouterLink :to="to" :data-tour="dataTour" :aria-describedby="signal ? descriptionId : undefined" @click="handleNavigate">
        <span class="relative inline-flex h-5 w-5 shrink-0 items-center justify-center">
          <component
            :is="icon"
            v-if="typeof icon !== 'string'"
            :size="NAV_ICON_SIZE"
            :data-signal="activity"
            class="nav-signal-glyph text-sidebar-foreground transition-colors duration-150 group-data-[active=true]/item:text-primary"
          />
          <AppIcon
            v-else
            :icon="icon"
            :fallback="fallbackIcon"
            :size="NAV_ICON_SIZE"
            :data-signal="activity"
            class="nav-signal-glyph text-sidebar-foreground transition-colors duration-150 group-data-[active=true]/item:text-primary"
          />
          <span
            v-if="signal?.attention"
            class="pointer-events-none absolute -end-0.5 -top-px hidden size-[7px] rounded-full bg-primary ring-2 ring-(--shell-surface) group-data-[collapsible=icon]:block"
            aria-hidden="true"
          />
          <span
            v-if="signal?.failed"
            class="pointer-events-none absolute -end-0.5 -bottom-px size-[7px] rounded-full bg-destructive ring-2 ring-(--shell-surface)"
            aria-hidden="true"
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
    <div v-if="slots.trailing" class="absolute right-1 top-0 flex h-7 items-center group-data-[collapsible=icon]:hidden">
      <slot name="trailing" />
    </div>
    <span v-if="signal" :id="descriptionId" class="sr-only">{{ signal.description }}</span>
    <slot name="extra" />
  </SidebarMenuItem>
</template>
