<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ArrowLeft,
  BookOpen,
  BookText,
  Bookmark,
  BookmarkCheck,
  CircleHelp,
  Clock3,
  Columns3,
  FileText,
  Headphones,
  Maximize,
  Minimize,
  Pin,
  PinOff,
  Search,
  Settings,
} from '@lucide/vue'
import { useMediaQuery } from '@vueuse/core'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import ReaderSettingsSheet from '@/features/reader/shared/components/ReaderSettingsSheet.vue'
import { useFullscreen } from '../../shared/composables/useFullscreen'

const { t } = useI18n()

const props = defineProps<{
  chapterTitle: string
  isBookmarked: boolean
  settingsOpen: boolean
  footerMode: 0 | 1 | 2
  peekMode?: boolean
  isTtsActive?: boolean
  isTtsAvailable?: boolean
  isMediaOverlay?: boolean
  isPinned?: boolean
  showTapZones?: boolean
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
  startTts: []
  togglePin: []
  toggleTapZones: []
}>()

const { isFullscreen } = useFullscreen()

// The settings surface is one panel in two containers: an anchored popover where there
// is room beside the text, a bottom sheet where the thumb is and the page must stay visible.
const isCompact = useMediaQuery('(max-width: 639px)')

const ttsTooltip = computed(() => {
  if (props.isTtsActive) return props.isMediaOverlay ? t('reader.header.narrationPlaying') : t('reader.header.ttsPlaying')
  return props.isMediaOverlay ? t('reader.header.listenWithNarrationShort') : t('reader.header.listen')
})

function onSettingsOpenChange(open: boolean) {
  emit('update:settingsOpen', open)
}

/** Mirrors PopoverTrigger on the wide path, so the icon means the same thing in both containers. */
function toggleSettings() {
  emit('update:settingsOpen', !props.settingsOpen)
}

function getFooterModeIcon(mode: 0 | 1 | 2) {
  if (mode === 0) return FileText
  if (mode === 1) return Clock3
  return BookText
}

function getFooterModeTooltip(mode: 0 | 1 | 2): string {
  if (mode === 0) return t('reader.header.footerMode.pageProgress')
  if (mode === 1) return t('reader.header.footerMode.sessionTimeLeft')
  return t('reader.header.footerMode.chapterTimeLeft')
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
          <button class="viewer-btn" :aria-label="t('reader.header.goBack')" @click="emit('back')">
            <ArrowLeft :size="18" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{{ t('reader.header.goBack') }}</TooltipContent>
      </Tooltip>

      <div class="viewer-sep" />

      <Tooltip>
        <TooltipTrigger as-child>
          <button class="viewer-btn" :aria-label="t('reader.header.tableOfContents')" @click="emit('toggleSidebar')">
            <BookOpen :size="18" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{{ t('reader.header.tableOfContents') }}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger as-child>
          <button
            class="viewer-btn"
            :class="isBookmarked ? '!text-primary' : ''"
            :aria-label="t('reader.header.toggleBookmark')"
            @click="emit('toggleBookmark')"
          >
            <BookmarkCheck v-if="isBookmarked" :size="18" />
            <Bookmark v-else :size="18" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{{ t('reader.header.toggleBookmark') }}</TooltipContent>
      </Tooltip>
    </div>

    <!-- Title: desktop/tablet only to avoid overlap on narrow mobile headers -->
    <div class="hidden sm:absolute sm:inset-x-0 sm:top-0 sm:h-12 sm:flex sm:items-center sm:justify-center sm:pointer-events-none">
      <p class="text-sm font-serif font-medium truncate text-center text-muted-foreground max-w-[40vw]">{{ chapterTitle }}</p>
    </div>

    <!-- Right button group -->
    <div class="flex items-center gap-1 shrink-0 ml-auto">
      <div v-if="props.peekMode" class="flex h-7 items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-1.5 text-primary">
        <span class="hidden text-[11px] font-medium sm:inline">{{ t('reader.peek.badge') }}</span>
        <button
          class="h-5 rounded-sm bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 sm:h-6 sm:px-2 sm:text-[11px]"
          @click="emit('startReading')"
        >
          {{ t('reader.peek.startReading') }}
        </button>
      </div>

      <Tooltip v-if="props.isTtsAvailable !== false">
        <TooltipTrigger as-child>
          <button
            class="viewer-btn"
            :class="props.isTtsActive ? '!text-primary' : ''"
            :aria-label="props.isMediaOverlay ? t('reader.header.listenWithNarration') : t('reader.header.listenWithTts')"
            @click="emit('startTts')"
          >
            <Headphones :size="18" :class="{ 'animate-pulse': props.isTtsActive }" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{{ ttsTooltip }}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger as-child>
          <button class="viewer-btn" :aria-label="t('common.search')" @click="emit('toggleSearch')">
            <Search :size="18" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{{ t('common.search') }}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger as-child>
          <button class="viewer-btn hidden sm:flex" :aria-label="t('reader.header.cycleFooterMode')" @click="emit('cycleFooterMode')">
            <component :is="getFooterModeIcon(props.footerMode)" :size="16" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{{ getFooterModeTooltip(props.footerMode) }}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger as-child>
          <button class="viewer-btn hidden sm:flex" :aria-label="t('reader.shortcuts.title')" @click="emit('toggleHelp')">
            <CircleHelp :size="18" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{{ t('reader.header.keyboardShortcutsHint') }}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger as-child>
          <button
            class="viewer-btn"
            :aria-label="isFullscreen ? t('reader.header.exitFullscreen') : t('reader.header.enterFullscreen')"
            @click="emit('toggleFullscreen')"
          >
            <Minimize v-if="isFullscreen" :size="18" />
            <Maximize v-else :size="18" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{{ isFullscreen ? t('reader.header.exitFullscreen') : t('reader.header.enterFullscreen') }}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger as-child>
          <button
            class="viewer-btn hidden sm:flex"
            :class="props.showTapZones ? '!bg-muted !text-primary' : ''"
            aria-label="Toggle tap zones"
            @click="emit('toggleTapZones')"
          >
            <Columns3 :size="18" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Show tap zones</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger as-child>
          <button
            class="viewer-btn hidden sm:flex"
            :class="props.isPinned ? '!bg-muted !text-primary' : ''"
            :aria-label="props.isPinned ? 'Unpin menu' : 'Pin menu'"
            @click="emit('togglePin')"
          >
            <PinOff v-if="props.isPinned" :size="18" />
            <Pin v-else :size="18" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{{ props.isPinned ? 'Unpin menu' : 'Pin menu' }}</TooltipContent>
      </Tooltip>

      <template v-if="isCompact">
        <button
          class="viewer-btn"
          :class="props.settingsOpen ? '!bg-muted !text-foreground' : ''"
          :title="t('reader.settings.title')"
          :aria-label="t('reader.settings.ariaLabel')"
          @click="toggleSettings"
        >
          <Settings :size="18" />
        </button>
        <ReaderSettingsSheet :open="props.settingsOpen" @update:open="onSettingsOpenChange">
          <slot name="settingsPanel" />
        </ReaderSettingsSheet>
      </template>

      <Popover v-else :open="props.settingsOpen" @update:open="onSettingsOpenChange">
        <PopoverTrigger as-child>
          <button
            class="viewer-btn"
            :class="props.settingsOpen ? '!bg-muted !text-foreground' : ''"
            :title="t('reader.settings.title')"
            :aria-label="t('reader.settings.ariaLabel')"
          >
            <Settings :size="18" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          side="bottom"
          :side-offset="10"
          class="flex max-h-[min(80vh,40rem)] w-[21rem] max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-xl border-border bg-card p-0 shadow-2xl"
        >
          <slot name="settingsPanel" />
        </PopoverContent>
      </Popover>
    </div>
  </header>
</template>
