<script setup lang="ts">
import { computed } from 'vue'
import { ChevronDown, Plus, GripVertical, Check, MoreVertical } from 'lucide-vue-next'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useThemeStore } from '@/stores/theme'

const props = defineProps<{
  label: string
  isOpen: boolean
  collapsedCount?: number
  canAdd?: boolean
  addTitle?: string
  canReorder?: boolean
  isReordering?: boolean
}>()

const emit = defineEmits<{ toggle: []; add: []; toggleReorder: [] }>()

const themeStore = useThemeStore()
const iconRadiusClass = computed(() => (themeStore.radius === 'sharp' ? 'rounded-none' : 'rounded-full'))

const hasMenu = () => props.canAdd || props.canReorder
</script>

<template>
  <div class="flex h-8.5 items-center px-2 group-data-[collapsible=icon]:hidden">
    <button class="group/hdr flex min-w-0 flex-1 items-center gap-1.5" @click="emit('toggle')">
      <span
        class="text-[11px] font-medium uppercase tracking-[0.16em] text-sidebar-foreground/65 transition-colors group-hover/hdr:text-sidebar-foreground/80"
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
    <DropdownMenu v-if="hasMenu()">
      <DropdownMenuTrigger
        class="ml-1 flex h-6 w-6 shrink-0 items-center justify-center transition-colors hover:bg-sidebar-accent"
        :class="[isReordering ? 'text-primary' : 'text-primary/90 hover:text-primary', iconRadiusClass]"
        @click.stop
      >
        <MoreVertical :size="15" :stroke-width="2.2" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" :side-offset="4">
        <DropdownMenuItem v-if="canAdd" @click="emit('add')">
          <Plus class="size-4" />
          {{ addTitle ?? 'Add' }}
        </DropdownMenuItem>
        <DropdownMenuSeparator v-if="canAdd && canReorder" />
        <DropdownMenuItem v-if="canReorder" @click="emit('toggleReorder')">
          <Check v-if="isReordering" class="size-4 text-primary" />
          <GripVertical v-else class="size-4" />
          {{ isReordering ? 'Done reordering' : 'Reorder' }}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>
