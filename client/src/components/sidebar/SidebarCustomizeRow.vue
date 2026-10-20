<script setup lang="ts">
import type { Component } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import SidebarCustomizeControls from '@/components/sidebar/SidebarCustomizeControls.vue'

withDefaults(
  defineProps<{
    icon: Component | string
    label: string
    hidden?: boolean
    locked?: boolean
    lifted?: boolean
    /** Shown under a hidden row that still comes back on its own. */
    hiddenHint?: string
  }>(),
  { hidden: false, locked: false, lifted: false, hiddenHint: undefined },
)

const emit = defineEmits<{ toggle: []; 'grip-keydown': [KeyboardEvent]; 'grip-blur': [] }>()

const NAV_ICON_SIZE = 17

function handleToggle() {
  emit('toggle')
}

function handleGripKeydown(event: KeyboardEvent) {
  emit('grip-keydown', event)
}

function handleGripBlur() {
  emit('grip-blur')
}
</script>

<template>
  <!-- Same box as a nav row (28px, px-2, 20px icon slot) so nothing shifts on entering edit mode. -->
  <li class="list-none rounded-md transition-colors duration-150" :class="lifted ? 'bg-(--shell-accent-wash)' : ''">
    <div class="flex h-7 min-w-0 items-center gap-2 ps-2 pe-2">
      <span class="inline-flex h-5 w-5 shrink-0 items-center justify-center">
        <component
          :is="icon"
          v-if="typeof icon !== 'string'"
          :size="NAV_ICON_SIZE"
          :class="hidden ? 'text-muted-foreground' : 'text-sidebar-foreground'"
        />
        <AppIcon v-else :icon="icon" :size="NAV_ICON_SIZE" :class="hidden ? 'text-muted-foreground' : 'text-sidebar-foreground'" />
      </span>
      <span class="min-w-0 flex-1 truncate text-[14px]" :class="hidden ? 'text-muted-foreground' : 'text-sidebar-foreground'">{{ label }}</span>
      <SidebarCustomizeControls
        :name="label"
        :hidden="hidden"
        :locked="locked"
        :lifted="lifted"
        handle-class="row-drag-handle"
        @toggle="handleToggle"
        @grip-keydown="handleGripKeydown"
        @grip-blur="handleGripBlur"
      />
    </div>
    <p v-if="hidden && hiddenHint" class="-mt-0.5 ps-9 pe-2 pb-1 text-[13px] leading-snug text-muted-foreground">{{ hiddenHint }}</p>
  </li>
</template>
