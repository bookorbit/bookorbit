<script setup lang="ts">
import { computed, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import { BookCopy, Podcast } from '@lucide/vue'
import type { LibraryType } from '@bookorbit/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const props = defineProps<{
  mode: LibraryType
  /** Collapsed desktop sidebar: the segments stack as icon-only buttons. */
  rail?: boolean
}>()

const emit = defineEmits<{ switch: [mode: LibraryType] }>()

const { t } = useI18n()

interface ModeOption {
  id: LibraryType
  label: string
  icon: Component
}

const options = computed<ModeOption[]>(() => [
  { id: 'books', label: t('components.sidebar.mode.books'), icon: BookCopy },
  { id: 'podcasts', label: t('components.sidebar.mode.podcasts'), icon: Podcast },
])

function handleSelect(target: LibraryType) {
  if (target !== props.mode) emit('switch', target)
}
</script>

<template>
  <div v-if="rail" role="group" :aria-label="t('components.sidebar.mode.switcherAria')" class="flex flex-col items-center gap-1">
    <Tooltip v-for="option in options" :key="option.id">
      <TooltipTrigger as-child>
        <button
          type="button"
          class="flex h-8 w-8 items-center justify-center rounded-md outline-hidden transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          :class="option.id === mode ? 'bg-(--shell-accent-tint) text-primary' : 'text-sidebar-foreground hover:bg-(--shell-accent-wash)'"
          :aria-pressed="option.id === mode"
          @click="handleSelect(option.id)"
        >
          <component :is="option.icon" :size="16" aria-hidden="true" />
          <span class="sr-only">{{ option.label }}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{{ option.label }}</TooltipContent>
    </Tooltip>
  </div>

  <div
    v-else
    role="group"
    :aria-label="t('components.sidebar.mode.switcherAria')"
    class="flex h-8 items-center gap-0.5 rounded-md border border-(--shell-accent-line) p-0.5"
  >
    <button
      v-for="option in options"
      :key="option.id"
      type="button"
      class="flex h-full min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[5px] px-2 text-[13px] font-medium outline-hidden transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      :class="option.id === mode ? 'bg-(--shell-accent-tint) text-primary' : 'text-sidebar-foreground hover:bg-(--shell-accent-wash)'"
      :aria-pressed="option.id === mode"
      @click="handleSelect(option.id)"
    >
      <component :is="option.icon" :size="14" aria-hidden="true" class="shrink-0" />
      <span class="truncate">{{ option.label }}</span>
    </button>
  </div>
</template>
