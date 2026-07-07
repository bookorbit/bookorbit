<script setup lang="ts">
import {
  ArrowLeft,
  BookOpen,
  BookText,
  Bookmark,
  BookmarkCheck,
  CircleHelp,
  Clock3,
  FileText,
  Maximize,
  Minimize,
  Search,
  Settings,
} from '@lucide/vue'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useFullscreen } from '../../shared/composables/useFullscreen'

const props = defineProps<{
  chapterTitle: string
  isBookmarked: boolean
  settingsOpen: boolean
  footerMode: 0 | 1 | 2
  peekMode?: boolean
}>()

const emit = defineEmits<{
  back: []
  toggleSidebar: []
  toggleSearch: []
  toggleBookmark: []
  'update:settingsOpen': [open: boolean]
  toggleFullscreen: []
  toggleHelp: []
  cycleFooterMode: []
  startReading: []
}>()

const { isFullscreen } = useFullscreen()

function onSettingsOpenChange(open: boolean) {
  emit('update:settingsOpen', open)
}

function getFooterModeIcon(mode: 0 | 1 | 2) {
  if (mode === 0) return FileText
  if (mode === 1) return Clock3
  return BookText
}

function getFooterModeTooltip(mode: 0 | 1 | 2): string {
  if (mode === 0) return 'Footer info: page + progress'
  if (mode === 1) return 'Footer info: reading session + time left'
  return 'Footer info: chapter + chapter time left'
}
</script>

<template>
  <header
    class="fixed top-0 left-0 right-0 h-10 sm:h-11 z-50 flex items-center px-2 sm:px-3 gap-1 bg-background/90 backdrop-blur-md border-b border-border"
  >
    <!-- Left button group -->
    <div class="flex items-center gap-1 shrink-0">
      <Tooltip>
        <TooltipTrigger as-child>
          <button class="viewer-btn" aria-label="Go back" @click="emit('back')">
            <ArrowLeft :size="18" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Go back</TooltipContent>
      </Tooltip>

      <div class="viewer-sep" />

      <Tooltip>
        <TooltipTrigger as-child>
          <button class="viewer-btn" aria-label="Table of contents" @click="emit('toggleSidebar')">
            <BookOpen :size="18" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Table of contents</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger as-child>
          <button class="viewer-btn" :class="isBookmarked ? '!text-primary' : ''" aria-label="Toggle bookmark" @click="emit('toggleBookmark')">
            <BookmarkCheck v-if="isBookmarked" :size="18" />
            <Bookmark v-else :size="18" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Toggle bookmark</TooltipContent>
      </Tooltip>
    </div>

    <!-- Title: desktop/tablet only to avoid overlap on narrow mobile headers -->
    <div class="hidden sm:absolute sm:inset-x-0 sm:top-0 sm:h-12 sm:flex sm:items-center sm:justify-center sm:pointer-events-none">
      <p class="text-sm font-serif font-medium truncate text-center text-muted-foreground max-w-[40vw]">{{ chapterTitle }}</p>
    </div>

    <!-- Right button group -->
    <div class="flex items-center gap-1 shrink-0 ml-auto">
      <div v-if="props.peekMode" class="flex h-7 items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-1.5 text-primary">
        <span class="hidden text-[11px] font-medium sm:inline">Peeking</span>
        <button
          class="h-5 rounded-sm bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 sm:h-6 sm:px-2 sm:text-[11px]"
          @click="emit('startReading')"
        >
          Start reading
        </button>
      </div>

      <Tooltip>
        <TooltipTrigger as-child>
          <button class="viewer-btn" aria-label="Search" @click="emit('toggleSearch')">
            <Search :size="18" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Search</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger as-child>
          <button class="viewer-btn hidden sm:flex" aria-label="Cycle footer info mode" @click="emit('cycleFooterMode')">
            <component :is="getFooterModeIcon(props.footerMode)" :size="16" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{{ getFooterModeTooltip(props.footerMode) }}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger as-child>
          <button class="viewer-btn hidden sm:flex" aria-label="Keyboard shortcuts" @click="emit('toggleHelp')">
            <CircleHelp :size="18" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Keyboard shortcuts (?)</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger as-child>
          <button class="viewer-btn" :aria-label="isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'" @click="emit('toggleFullscreen')">
            <Minimize v-if="isFullscreen" :size="18" />
            <Maximize v-else :size="18" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{{ isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen' }}</TooltipContent>
      </Tooltip>

      <DropdownMenu :open="props.settingsOpen" @update:open="onSettingsOpenChange">
        <DropdownMenuTrigger as-child>
          <button class="viewer-btn" :class="props.settingsOpen ? '!bg-muted !text-foreground' : ''" title="Settings" aria-label="Reader settings">
            <Settings :size="18" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          side="bottom"
          :side-offset="10"
          class="w-[22rem] max-w-[calc(100vw-1rem)] max-h-[min(80vh,38rem)] rounded-lg border-border bg-card p-0 shadow-2xl overflow-hidden"
        >
          <slot name="settingsPanel" />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </header>
</template>
