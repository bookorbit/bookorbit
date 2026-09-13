<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, Check, GripVertical, MoreVertical, Plus } from '@lucide/vue'
import { SIDEBAR_CAP_OPTIONS, type SidebarCap } from '@bookorbit/types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatCompactNumber, formatNumber } from '@/i18n/formatters'
import { useThemeStore } from '@/stores/theme'

const props = withDefaults(
  defineProps<{
    label: string
    isOpen: boolean
    contentId: string
    count?: number
    canAdd?: boolean
    addLabel?: string
    cap?: SidebarCap
    canChangeCap?: boolean
    canReorder?: boolean
    isReordering?: boolean
    /** Rail popovers show the body unconditionally, so the toggle becomes a plain label. */
    collapsible?: boolean
  }>(),
  { collapsible: true },
)

const emit = defineEmits<{ toggle: []; add: []; 'update:cap': [SidebarCap]; 'toggle-reorder': [] }>()

const { t } = useI18n()
const themeStore = useThemeStore()
const iconRadiusClass = computed(() => (themeStore.radius === 'sharp' ? 'rounded-none' : 'rounded-full'))

function handleToggle() {
  emit('toggle')
}

function handleAdd() {
  emit('add')
}

function selectCap(cap: SidebarCap) {
  emit('update:cap', cap)
}

function handleToggleReorder() {
  emit('toggle-reorder')
}

const hasMenu = computed(() => props.canChangeCap || props.canReorder)

function capLabel(cap: SidebarCap): string {
  return cap === 'all' ? t('components.sidebar.sectionHeader.showAll') : t('components.sidebar.sectionHeader.showCount', { count: formatNumber(cap) })
}

const showCount = computed(() => !props.isOpen && typeof props.count === 'number' && props.count > 0)
</script>

<template>
  <div class="flex h-8 items-center gap-0.5 group-data-[collapsible=icon]:hidden">
    <button
      v-if="collapsible"
      type="button"
      class="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 text-left outline-hidden transition-colors duration-150 hover:bg-(--shell-accent-wash) focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      :aria-expanded="isOpen"
      :aria-controls="contentId"
      @click="handleToggle"
    >
      <span class="min-w-0 truncate text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{{ label }}</span>
      <span
        v-if="showCount"
        class="shrink-0 rounded-md bg-(--shell-accent-tint) px-1.5 text-[11px] font-semibold tabular-nums text-sidebar-count-foreground"
      >
        {{ formatCompactNumber(count ?? 0) }}
      </span>
      <ChevronDown
        :size="13"
        :stroke-width="2.5"
        aria-hidden="true"
        class="ml-auto shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none"
        :class="isOpen ? 'rotate-0' : '-rotate-90'"
      />
    </button>
    <p v-else class="min-w-0 flex-1 truncate px-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{{ label }}</p>

    <button
      v-if="canAdd"
      type="button"
      class="flex h-6 w-6 shrink-0 items-center justify-center text-primary outline-hidden transition-colors duration-150 hover:bg-(--shell-accent-wash) focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      :class="iconRadiusClass"
      :aria-label="addLabel ?? t('components.sidebar.sectionHeader.add')"
      :title="addLabel ?? t('components.sidebar.sectionHeader.add')"
      @click="handleAdd"
    >
      <Plus :size="13" :stroke-width="2.5" aria-hidden="true" />
    </button>

    <DropdownMenu v-if="hasMenu">
      <DropdownMenuTrigger
        class="flex h-6 w-6 shrink-0 items-center justify-center outline-hidden transition-colors duration-150 hover:bg-(--shell-accent-wash) hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        :class="[iconRadiusClass, isReordering ? 'text-primary' : 'text-muted-foreground']"
        :aria-label="t('components.sidebar.sectionHeader.menuAria', { section: label })"
      >
        <MoreVertical :size="13" :stroke-width="2.5" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" :side-offset="4">
        <template v-if="canChangeCap">
          <DropdownMenuLabel>{{ t('components.sidebar.sectionHeader.rowsShown') }}</DropdownMenuLabel>
          <DropdownMenuItem v-for="option in SIDEBAR_CAP_OPTIONS" :key="String(option)" @click="selectCap(option)">
            <Check v-if="cap === option" :size="13" class="text-primary" />
            <span v-else class="w-[13px]" />
            {{ capLabel(option) }}
          </DropdownMenuItem>
        </template>
        <DropdownMenuSeparator v-if="canChangeCap && canReorder" />
        <DropdownMenuItem v-if="canReorder" @click="handleToggleReorder">
          <Check v-if="isReordering" :size="13" class="text-primary" />
          <GripVertical v-else :size="13" />
          {{ isReordering ? t('components.sidebar.sectionHeader.doneReordering') : t('components.sidebar.sectionHeader.reorder') }}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>
