<script setup lang="ts">
import { type Component } from 'vue'
import {
  ArrowLeft,
  ArrowDownUp,
  ArrowLeftRight,
  ChevronDown,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  Download,
  Grab,
  LayoutGrid,
  Maximize,
  Minimize,
  Minus,
  MoreHorizontal,
  MousePointer,
  PanelLeft,
  Plus,
  Search,
  ScanLine,
  WrapText,
} from 'lucide-vue-next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { ScrollMode } from '../composables/usePdfLayout'
import type { AcceptableValue } from 'reka-ui'
import { usePermissions } from '@/features/auth/composables/usePermissions'

const { hasPermission } = usePermissions()

const props = defineProps<{
  currentPage: number
  totalPages: number
  pageInput: number
  zoomLabel: string
  zoomMode: string
  customScale: number
  scale: number
  spread: 'none' | 'odd' | 'even'
  scrollMode: ScrollMode
  isFullscreen: boolean
  showSidebar: boolean
  showFind: boolean
  cursorTool: 'select' | 'hand'
  fileId: number
}>()

const emit = defineEmits<{
  back: []
  toggleSidebar: []
  toggleFind: []
  prevPage: []
  nextPage: []
  firstPage: []
  lastPage: []
  commitPage: [page: number]
  zoomOut: []
  zoomIn: []
  applyZoomPreset: [value: string]
  toggleFullscreen: []
  'update:spread': [v: 'none' | 'odd' | 'even']
  'update:scrollMode': [v: ScrollMode]
  'update:cursorTool': [v: 'select' | 'hand']
}>()

const ZOOM_PERCENT_PRESETS = [
  { label: '50%', value: '0.5' },
  { label: '75%', value: '0.75' },
  { label: '100%', value: '1' },
  { label: '125%', value: '1.25' },
  { label: '150%', value: '1.5' },
  { label: '175%', value: '1.75' },
  { label: '200%', value: '2' },
  { label: '300%', value: '3' },
  { label: '400%', value: '4' },
] as const

const SCROLL_MODES: { label: string; value: ScrollMode; icon: Component }[] = [
  { label: 'Vertical Scrolling', value: 'vertical', icon: ArrowDownUp },
  { label: 'Horizontal Scrolling', value: 'horizontal', icon: ArrowLeftRight },
  { label: 'Wrapped Scrolling', value: 'wrapped', icon: LayoutGrid },
  { label: 'Page Scrolling', value: 'page', icon: ScanLine },
]

const SPREAD_MODES = [
  { label: 'No Spreads', value: 'none' as const },
  { label: 'Odd Spreads', value: 'odd' as const },
  { label: 'Even Spreads', value: 'even' as const },
]

function onPageInput(e: Event) {
  const val = parseInt((e.target as HTMLInputElement).value)
  if (!isNaN(val)) emit('commitPage', val)
}

function currentZoomValue(): string {
  if (props.zoomMode === 'fit-page') return 'fit-page'
  if (props.zoomMode === 'fit-width') return 'fit-width'
  return String(props.customScale)
}

function handleApplyZoomPreset(value: AcceptableValue) {
  emit('applyZoomPreset', String(value))
}
</script>

<template>
  <div class="h-11 flex items-center px-2 gap-0.5 shrink-0 z-50 bg-background border-b border-border shadow-sm">
    <!-- Back -->
    <Tooltip>
      <TooltipTrigger as-child>
        <button class="viewer-btn" @click="emit('back')"><ArrowLeft :size="15" /></button>
      </TooltipTrigger>
      <TooltipContent>Back</TooltipContent>
    </Tooltip>

    <div class="viewer-sep" />

    <!-- Sidebar toggle -->
    <Tooltip>
      <TooltipTrigger as-child>
        <button class="viewer-btn" :class="showSidebar ? '!bg-muted !text-foreground' : ''" @click="emit('toggleSidebar')">
          <PanelLeft :size="15" />
        </button>
      </TooltipTrigger>
      <TooltipContent>Toggle Sidebar</TooltipContent>
    </Tooltip>

    <!-- Find toggle -->
    <Tooltip>
      <TooltipTrigger as-child>
        <button class="viewer-btn" :class="showFind ? '!bg-muted !text-foreground' : ''" @click="emit('toggleFind')">
          <Search :size="14" />
        </button>
      </TooltipTrigger>
      <TooltipContent>Find (Ctrl+F)</TooltipContent>
    </Tooltip>

    <div class="viewer-sep" />

    <!-- Page navigation -->
    <Tooltip>
      <TooltipTrigger as-child>
        <button class="viewer-btn" :disabled="currentPage <= 1" @click="emit('prevPage')">
          <ChevronLeft :size="15" />
        </button>
      </TooltipTrigger>
      <TooltipContent>Previous Page</TooltipContent>
    </Tooltip>

    <div class="flex items-center gap-1 mx-0.5">
      <input
        :value="pageInput"
        type="number"
        min="1"
        :max="totalPages"
        class="w-10 text-center rounded px-1 py-0.5 bg-muted text-foreground text-xs outline-none focus:ring-1 focus:ring-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        @keydown.enter="onPageInput"
        @blur="onPageInput"
      />
      <span class="text-muted-foreground text-xs">/</span>
      <span class="text-muted-foreground text-xs tabular-nums">{{ totalPages }}</span>
    </div>

    <Tooltip>
      <TooltipTrigger as-child>
        <button class="viewer-btn" :disabled="currentPage >= totalPages" @click="emit('nextPage')">
          <ChevronRight :size="15" />
        </button>
      </TooltipTrigger>
      <TooltipContent>Next Page</TooltipContent>
    </Tooltip>

    <div class="viewer-sep" />

    <!-- Zoom controls -->
    <Tooltip>
      <TooltipTrigger as-child>
        <button class="viewer-btn" @click="emit('zoomOut')"><Minus :size="13" /></button>
      </TooltipTrigger>
      <TooltipContent>Zoom Out</TooltipContent>
    </Tooltip>

    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <button
          class="flex items-center gap-1 px-2 h-7 rounded text-foreground/80 hover:text-foreground hover:bg-muted text-xs tabular-nums transition-colors"
          style="min-width: 84px"
        >
          <span class="flex-1 text-center">{{ zoomLabel }}</span>
          <ChevronDown :size="10" class="text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" class="min-w-[9rem]">
        <DropdownMenuRadioGroup :model-value="currentZoomValue()" @update:model-value="handleApplyZoomPreset">
          <DropdownMenuRadioItem value="fit-page" class="text-xs">Page Fit</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="fit-width" class="text-xs">Page Width</DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          <DropdownMenuRadioItem v-for="preset in ZOOM_PERCENT_PRESETS" :key="preset.value" :value="preset.value" class="text-xs">
            {{ preset.label }}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>

    <Tooltip>
      <TooltipTrigger as-child>
        <button class="viewer-btn" @click="emit('zoomIn')"><Plus :size="13" /></button>
      </TooltipTrigger>
      <TooltipContent>Zoom In</TooltipContent>
    </Tooltip>

    <!-- Spacer -->
    <div class="flex-1" />

    <!-- Right side controls -->
    <Tooltip>
      <TooltipTrigger as-child>
        <button class="viewer-btn" @click="emit('toggleFullscreen')">
          <Minimize v-if="isFullscreen" :size="14" />
          <Maximize v-else :size="14" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{{ isFullscreen ? 'Exit Fullscreen' : 'Fullscreen' }}</TooltipContent>
    </Tooltip>

    <Tooltip v-if="hasPermission('library_download')">
      <TooltipTrigger as-child>
        <a :href="`/api/v1/books/files/${fileId}/download`" class="viewer-btn flex items-center justify-center">
          <Download :size="14" />
        </a>
      </TooltipTrigger>
      <TooltipContent>Download</TooltipContent>
    </Tooltip>

    <div class="viewer-sep" />

    <!-- Secondary toolbar (More tools) -->
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <button class="viewer-btn" title="More Tools">
          <MoreHorizontal :size="16" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" class="w-52">
        <DropdownMenuGroup>
          <DropdownMenuItem class="text-xs gap-2" @click="emit('firstPage')"> <ChevronFirst :size="13" /> First Page </DropdownMenuItem>
          <DropdownMenuItem class="text-xs gap-2" @click="emit('lastPage')"> <ChevronLast :size="13" /> Last Page </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuLabel class="text-muted-foreground text-xs px-2 py-1">Cursor Tool</DropdownMenuLabel>
        <DropdownMenuRadioGroup :model-value="cursorTool" @update:model-value="emit('update:cursorTool', $event as 'select' | 'hand')">
          <DropdownMenuRadioItem value="select" class="text-xs gap-2"> <MousePointer :size="13" /> Text Selection </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="hand" class="text-xs gap-2"> <Grab :size="13" /> Hand Tool </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />

        <DropdownMenuLabel class="text-muted-foreground text-xs px-2 py-1">Scroll Mode</DropdownMenuLabel>
        <DropdownMenuRadioGroup :model-value="scrollMode" @update:model-value="emit('update:scrollMode', $event as ScrollMode)">
          <DropdownMenuRadioItem v-for="sm in SCROLL_MODES" :key="sm.value" :value="sm.value" class="text-xs gap-2">
            <component :is="sm.icon" :size="13" />
            {{ sm.label }}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />

        <DropdownMenuLabel class="text-muted-foreground text-xs px-2 py-1">Page Spread</DropdownMenuLabel>
        <DropdownMenuRadioGroup :model-value="spread" @update:model-value="emit('update:spread', $event as 'none' | 'odd' | 'even')">
          <DropdownMenuRadioItem v-for="sp in SPREAD_MODES" :key="sp.value" :value="sp.value" class="text-xs">
            <WrapText :size="13" /> {{ sp.label }}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>
