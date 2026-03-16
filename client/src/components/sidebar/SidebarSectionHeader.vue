<script setup lang="ts">
import { ChevronDown, Plus } from 'lucide-vue-next'

defineProps<{
  label: string
  isOpen: boolean
  collapsedCount?: number
  canAdd?: boolean
  addTitle?: string
}>()

const emit = defineEmits<{ toggle: []; add: [] }>()
</script>

<template>
  <div class="flex h-8.5 items-center px-2 group-data-[collapsible=icon]:hidden">
    <button class="group/hdr flex min-w-0 flex-1 items-center gap-1.5" @click="emit('toggle')">
      <span
        class="text-[11px] font-medium uppercase tracking-[0.16em] text-sidebar-foreground/45 transition-colors group-hover/hdr:text-sidebar-foreground/80"
      >
        {{ label }}
      </span>
      <span
        v-if="!isOpen && collapsedCount && collapsedCount > 0"
        class="rounded-full bg-sidebar-foreground/10 px-1.5 py-0.5 text-[9px] font-bold text-sidebar-foreground/50 transition-colors group-hover/hdr:bg-sidebar-foreground/15 group-hover/hdr:text-sidebar-foreground/70"
      >
        {{ collapsedCount }}
      </span>
      <ChevronDown
        :size="13"
        :stroke-width="2.5"
        class="ml-auto shrink-0 text-sidebar-foreground/35 transition-transform duration-200 group-hover/hdr:text-sidebar-foreground/70"
        :class="isOpen ? 'rotate-0' : '-rotate-90'"
      />
    </button>
    <button
      v-if="canAdd"
      class="ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/45 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground/90"
      :title="addTitle"
      @click="emit('add')"
    >
      <Plus :size="15" :stroke-width="2.2" />
    </button>
  </div>
</template>
