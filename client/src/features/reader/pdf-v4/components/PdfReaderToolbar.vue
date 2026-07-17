<script setup lang="ts">
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Hand,
  Maximize,
  Minimize,
  Minus,
  MoreHorizontal,
  MousePointer2,
  PanelLeft,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
} from '@lucide/vue'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const props = defineProps<{
  currentPageStart: number
  currentPageEnd: number
  totalPages: number
  zoomPercent: number
  sidebarOpen: boolean
  searchOpen: boolean
  settingsOpen: boolean
  panActive: boolean
  fullscreen: boolean
  fullscreenSupported: boolean
  headerPinned: boolean
  peekMode?: boolean
}>()

const emit = defineEmits<{
  back: []
  previousPage: []
  nextPage: []
  goToPage: [page: number]
  zoomOut: []
  zoomIn: []
  toggleSidebar: []
  toggleSearch: []
  togglePan: []
  selectTool: []
  toggleFullscreen: []
  toggleHeaderPin: []
  'update:settingsOpen': [open: boolean]
  startReading: []
}>()

function handleBack() {
  emit('back')
}

function handlePreviousPage() {
  emit('previousPage')
}

function handleNextPage() {
  emit('nextPage')
}

function handlePageCommit(event: Event) {
  const input = event.target as HTMLInputElement
  const page = Number.parseInt(input.value, 10)
  if (!Number.isFinite(page)) {
    input.value = String(props.currentPageStart)
    return
  }
  const clamped = Math.min(Math.max(page, 1), props.totalPages || 1)
  input.value = String(clamped)
  emit('goToPage', clamped)
}

function handleZoomOut() {
  emit('zoomOut')
}

function handleZoomIn() {
  emit('zoomIn')
}

function handleToggleSidebar() {
  emit('toggleSidebar')
}

function handleToggleSearch() {
  emit('toggleSearch')
}

function handleTogglePan() {
  emit('togglePan')
}

function handleSelectTool() {
  emit('selectTool')
}

function handleToggleFullscreen() {
  emit('toggleFullscreen')
}

function handleToggleHeaderPin() {
  emit('toggleHeaderPin')
}

function handleSettingsOpenChange(open: boolean) {
  emit('update:settingsOpen', open)
}

function handleStartReading() {
  emit('startReading')
}
</script>

<template>
  <header class="relative z-50 flex h-11 shrink-0 items-center gap-1 border-b border-border bg-background/95 px-2 backdrop-blur-md sm:px-3">
    <div class="flex shrink-0 items-center gap-1">
      <Tooltip>
        <TooltipTrigger as-child>
          <button class="viewer-btn" aria-label="Go back" @click="handleBack">
            <ArrowLeft :size="18" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Go back</TooltipContent>
      </Tooltip>

      <div class="viewer-sep" />

      <Tooltip>
        <TooltipTrigger as-child>
          <button
            class="viewer-btn"
            :class="props.sidebarOpen ? '!bg-muted !text-foreground' : ''"
            aria-label="Document navigation"
            @click="handleToggleSidebar"
          >
            <PanelLeft :size="18" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Document navigation</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger as-child>
          <button
            class="viewer-btn hidden md:flex"
            :class="props.searchOpen ? '!bg-muted !text-foreground' : ''"
            aria-label="Search document"
            @click="handleToggleSearch"
          >
            <Search :size="17" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Search document</TooltipContent>
      </Tooltip>
    </div>

    <div class="mx-auto flex min-w-0 items-center gap-1 sm:absolute sm:inset-x-0 sm:pointer-events-none sm:justify-center">
      <div class="flex items-center gap-1 sm:pointer-events-auto">
        <button
          class="viewer-btn hidden min-[380px]:flex"
          :disabled="props.currentPageStart <= 1"
          aria-label="Previous page"
          @click="handlePreviousPage"
        >
          <ChevronLeft :size="17" />
        </button>
        <div class="flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
          <input
            :value="props.currentPageStart"
            type="number"
            min="1"
            :max="props.totalPages"
            aria-label="Current page"
            class="h-7 w-11 rounded-md border border-border bg-muted/60 px-1 text-center text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            @change="handlePageCommit"
            @keydown.enter="handlePageCommit"
          />
          <span v-if="props.currentPageEnd > props.currentPageStart">-{{ props.currentPageEnd }}</span>
          <span>/ {{ props.totalPages || 0 }}</span>
        </div>
        <button
          class="viewer-btn hidden min-[380px]:flex"
          :disabled="props.currentPageEnd >= props.totalPages"
          aria-label="Next page"
          @click="handleNextPage"
        >
          <ChevronRight :size="17" />
        </button>
      </div>
    </div>

    <div class="ml-auto flex shrink-0 items-center gap-1">
      <div v-if="props.peekMode" class="flex h-7 items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-1.5 text-primary">
        <span class="hidden text-[11px] font-medium lg:inline">Peeking</span>
        <button
          class="h-6 rounded-sm bg-primary px-2 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90"
          @click="handleStartReading"
        >
          Start reading
        </button>
      </div>

      <div class="viewer-sep hidden md:block" />

      <div class="hidden items-center md:flex">
        <button class="viewer-btn" aria-label="Zoom out" @click="handleZoomOut">
          <Minus :size="15" />
        </button>
        <span class="min-w-12 text-center text-xs tabular-nums text-muted-foreground">{{ props.zoomPercent }}%</span>
        <button class="viewer-btn" aria-label="Zoom in" @click="handleZoomIn">
          <Plus :size="15" />
        </button>
      </div>

      <Tooltip>
        <TooltipTrigger as-child>
          <button
            class="viewer-btn hidden md:flex"
            :class="props.panActive ? '!bg-muted !text-foreground' : ''"
            aria-label="Pan tool"
            @click="handleTogglePan"
          >
            <Hand :size="17" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Pan tool</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger as-child>
          <button
            class="viewer-btn hidden md:flex"
            :class="!props.panActive ? '!bg-muted !text-foreground' : ''"
            aria-label="Select text tool"
            @click="handleSelectTool"
          >
            <MousePointer2 :size="17" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Select text</TooltipContent>
      </Tooltip>

      <Tooltip v-if="props.fullscreenSupported">
        <TooltipTrigger as-child>
          <button
            class="viewer-btn hidden md:flex"
            :aria-label="props.fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'"
            @click="handleToggleFullscreen"
          >
            <Minimize v-if="props.fullscreen" :size="17" />
            <Maximize v-else :size="17" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{{ props.fullscreen ? 'Exit fullscreen' : 'Enter fullscreen' }}</TooltipContent>
      </Tooltip>

      <Tooltip v-if="props.fullscreen">
        <TooltipTrigger as-child>
          <button
            class="viewer-btn hidden md:flex"
            :class="props.headerPinned ? '!bg-muted !text-foreground' : ''"
            :aria-label="props.headerPinned ? 'Unpin reader header' : 'Pin reader header'"
            @click="handleToggleHeaderPin"
          >
            <PinOff v-if="props.headerPinned" :size="17" />
            <Pin v-else :size="17" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{{ props.headerPinned ? 'Unpin header' : 'Pin header' }}</TooltipContent>
      </Tooltip>

      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <button class="viewer-btn md:hidden" aria-label="More PDF tools">
            <MoreHorizontal :size="18" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="bottom" :side-offset="8" class="w-56 border-border bg-card p-1.5 shadow-xl">
          <button class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs hover:bg-muted" @click="handleToggleSearch">
            <Search :size="15" /> Search
          </button>
          <button
            class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs hover:bg-muted"
            :class="!props.panActive ? 'bg-muted text-foreground' : ''"
            @click="handleSelectTool"
          >
            <MousePointer2 :size="15" /> Select text
          </button>
          <button
            class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs hover:bg-muted"
            :class="props.panActive ? 'bg-muted text-foreground' : ''"
            @click="handleTogglePan"
          >
            <Hand :size="15" /> Pan
          </button>
          <div class="my-1 border-t border-border" />
          <div class="flex items-center justify-between px-2.5 py-1.5 text-xs">
            <button class="viewer-btn !h-7 !w-7" aria-label="Zoom out" @click="handleZoomOut"><Minus :size="14" /></button>
            <span class="tabular-nums text-muted-foreground">{{ props.zoomPercent }}%</span>
            <button class="viewer-btn !h-7 !w-7" aria-label="Zoom in" @click="handleZoomIn"><Plus :size="14" /></button>
          </div>
          <button
            v-if="props.fullscreenSupported"
            class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs hover:bg-muted"
            @click="handleToggleFullscreen"
          >
            <Minimize v-if="props.fullscreen" :size="15" />
            <Maximize v-else :size="15" />
            {{ props.fullscreen ? 'Exit fullscreen' : 'Enter fullscreen' }}
          </button>
          <button
            v-if="props.fullscreen"
            class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs hover:bg-muted"
            :class="props.headerPinned ? 'bg-muted text-foreground' : ''"
            @click="handleToggleHeaderPin"
          >
            <PinOff v-if="props.headerPinned" :size="15" />
            <Pin v-else :size="15" />
            {{ props.headerPinned ? 'Unpin header' : 'Pin header' }}
          </button>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu :open="props.settingsOpen" @update:open="handleSettingsOpenChange">
        <DropdownMenuTrigger as-child>
          <button class="viewer-btn" :class="props.settingsOpen ? '!bg-muted !text-foreground' : ''" aria-label="PDF settings">
            <Settings :size="18" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          side="bottom"
          :side-offset="8"
          class="max-h-[min(80vh,38rem)] w-[22rem] max-w-[calc(100vw-1rem)] overflow-hidden rounded-lg border-border bg-card p-0 shadow-2xl"
        >
          <slot name="settings" />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </header>
</template>
