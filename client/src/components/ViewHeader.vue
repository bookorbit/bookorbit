<script setup lang="ts">
import { ref } from 'vue'
import { CheckSquare, Circle, LayoutGrid, List, MoreHorizontal, SlidersHorizontal, Square } from 'lucide-vue-next'
import * as LucideIcons from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

defineProps<{
  title: string
  icon?: string
  total: number
  coverSize: number
  gridGap: number
  viewMode: 'grid' | 'list'
  selectionMode?: boolean
  coverShape?: 'square' | 'circle'
}>()

const emit = defineEmits<{
  'update:coverSize': [value: number]
  'update:gridGap': [value: number]
  'update:viewMode': [value: 'grid' | 'list']
  'toggle-selection': []
  'update:coverShape': [value: 'square' | 'circle']
}>()

const mobileDisplayOpen = ref(false)

function getIconComponent(name: string) {
  return (LucideIcons as Record<string, unknown>)[name] ?? null
}
</script>

<template>
  <div class="sticky top-0 z-20 mb-2 mt-2 flex h-10 shrink-0 items-center gap-2 p-2 transition-all duration-300 bg-background/80 backdrop-blur-md">
    <!-- Left: icon + title + count -->
    <div class="flex items-center gap-2 flex-1 min-w-0">
      <component v-if="icon" :is="getIconComponent(icon)" :size="16" class="shrink-0 text-muted-foreground" />
      <span class="font-bold text-[16px] text-foreground/90 tracking-tight truncate">{{ title }}</span>
      <span class="text-[12px] font-semibold text-primary/70 tabular-nums">({{ total.toLocaleString() }})</span>
    </div>

    <!-- Right -->
    <div class="flex items-center gap-2 shrink-0">
      <slot name="toolbar" />
      <slot name="actions" />

      <!-- Select mode toggle -->
      <Button
        variant="ghost"
        size="sm"
        class="hidden md:flex h-8 gap-1.5 text-[11px] font-bold uppercase tracking-tight px-2.5 rounded-lg transition-all"
        :class="
          selectionMode
            ? 'text-primary bg-primary/10 hover:bg-primary/20 ring-1 ring-primary/20'
            : 'text-muted-foreground/80 hover:text-foreground hover:bg-primary/5'
        "
        @click="emit('toggle-selection')"
      >
        <CheckSquare v-if="selectionMode" :size="13" />
        <Square v-else :size="13" />
        Select
      </Button>

      <div class="hidden md:block w-px h-3.5 bg-border/40 mx-1.5" />

      <!-- Desktop: view mode toggle -->
      <div class="hidden md:flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          class="h-8 w-8 rounded-lg"
          :class="viewMode === 'grid' ? 'text-primary bg-primary/10' : 'text-muted-foreground/70 hover:text-foreground hover:bg-primary/5'"
          @click="emit('update:viewMode', 'grid')"
        >
          <LayoutGrid :size="14" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="h-8 w-8 rounded-lg"
          :class="viewMode === 'list' ? 'text-primary bg-primary/10' : 'text-muted-foreground/70 hover:text-foreground hover:bg-primary/5'"
          @click="emit('update:viewMode', 'list')"
        >
          <List :size="14" />
        </Button>
      </div>

      <!-- Desktop: display settings popover -->
      <Popover>
        <PopoverTrigger as-child>
          <Button
            variant="ghost"
            size="icon"
            class="hidden md:flex h-8 w-8 rounded-lg text-muted-foreground/70 hover:text-foreground hover:bg-primary/5"
          >
            <SlidersHorizontal :size="14" />
          </Button>
        </PopoverTrigger>
        <PopoverContent class="w-56 p-4" align="end">
          <div class="space-y-4">
            <p class="text-xs font-semibold text-foreground uppercase tracking-wider">Display</p>
            <div class="space-y-1.5">
              <div class="flex items-center justify-between">
                <span class="text-xs text-muted-foreground">Cover size</span>
                <span class="text-xs font-medium tabular-nums text-foreground">{{ coverSize }}px</span>
              </div>
              <input
                :value="coverSize"
                @input="emit('update:coverSize', Number(($event.target as HTMLInputElement).value))"
                type="range"
                min="100"
                max="280"
                step="10"
                class="w-full accent-primary cursor-pointer"
              />
            </div>
            <div class="space-y-1.5">
              <div class="flex items-center justify-between">
                <span class="text-xs text-muted-foreground">Grid gap</span>
                <span class="text-xs font-medium tabular-nums text-foreground">{{ gridGap }}px</span>
              </div>
              <input
                :value="gridGap"
                @input="emit('update:gridGap', Number(($event.target as HTMLInputElement).value))"
                type="range"
                min="4"
                max="40"
                step="4"
                class="w-full accent-primary cursor-pointer"
              />
            </div>
            <div v-if="coverShape !== undefined" class="space-y-1.5">
              <span class="text-xs text-muted-foreground">Cover shape</span>
              <div class="flex items-center gap-1 mt-1.5">
                <button
                  class="flex flex-1 items-center justify-center gap-1.5 rounded-md border py-1.5 text-xs font-medium transition-colors"
                  :class="
                    coverShape === 'circle'
                      ? 'border-primary text-primary bg-primary/8'
                      : 'border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/40'
                  "
                  @click="emit('update:coverShape', 'circle')"
                >
                  <Circle :size="12" /> Circle
                </button>
                <button
                  class="flex flex-1 items-center justify-center gap-1.5 rounded-md border py-1.5 text-xs font-medium transition-colors"
                  :class="
                    coverShape === 'square'
                      ? 'border-primary text-primary bg-primary/8'
                      : 'border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/40'
                  "
                  @click="emit('update:coverShape', 'square')"
                >
                  <Square :size="12" /> Square
                </button>
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <!-- Mobile: overflow dropdown -->
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="icon" class="md:hidden h-8 w-8 text-muted-foreground hover:text-foreground">
            <MoreHorizontal :size="15" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-44">
          <DropdownMenuRadioGroup :model-value="viewMode" @update:model-value="emit('update:viewMode', $event as 'grid' | 'list')">
            <DropdownMenuRadioItem value="grid">Grid</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="list">List</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem @click="mobileDisplayOpen = true">
            <SlidersHorizontal :size="14" class="mr-2" />
            Display
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem @click="emit('toggle-selection')">
            <CheckSquare v-if="selectionMode" :size="14" class="mr-2" />
            <Square v-else :size="14" class="mr-2" />
            {{ selectionMode ? 'Exit Select' : 'Select' }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </div>

  <!-- Mobile display sheet -->
  <Sheet v-model:open="mobileDisplayOpen">
    <SheetContent side="bottom">
      <SheetHeader>
        <SheetTitle>Display</SheetTitle>
      </SheetHeader>
      <div class="space-y-4 px-4 pb-6">
        <div class="space-y-1.5">
          <div class="flex items-center justify-between">
            <span class="text-xs text-muted-foreground">Cover size</span>
            <span class="text-xs font-medium tabular-nums text-foreground">{{ coverSize }}px</span>
          </div>
          <input
            :value="coverSize"
            @input="emit('update:coverSize', Number(($event.target as HTMLInputElement).value))"
            type="range"
            min="100"
            max="280"
            step="10"
            class="w-full accent-primary cursor-pointer"
          />
        </div>
        <div class="space-y-1.5">
          <div class="flex items-center justify-between">
            <span class="text-xs text-muted-foreground">Grid gap</span>
            <span class="text-xs font-medium tabular-nums text-foreground">{{ gridGap }}px</span>
          </div>
          <input
            :value="gridGap"
            @input="emit('update:gridGap', Number(($event.target as HTMLInputElement).value))"
            type="range"
            min="4"
            max="40"
            step="4"
            class="w-full accent-primary cursor-pointer"
          />
        </div>
        <div v-if="coverShape !== undefined" class="space-y-1.5">
          <span class="text-xs text-muted-foreground">Cover shape</span>
          <div class="flex items-center gap-1 mt-1.5">
            <button
              class="flex flex-1 items-center justify-center gap-1.5 rounded-md border py-1.5 text-xs font-medium transition-colors"
              :class="
                coverShape === 'circle'
                  ? 'border-primary text-primary bg-primary/8'
                  : 'border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/40'
              "
              @click="emit('update:coverShape', 'circle')"
            >
              <Circle :size="12" /> Circle
            </button>
            <button
              class="flex flex-1 items-center justify-center gap-1.5 rounded-md border py-1.5 text-xs font-medium transition-colors"
              :class="
                coverShape === 'square'
                  ? 'border-primary text-primary bg-primary/8'
                  : 'border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/40'
              "
              @click="emit('update:coverShape', 'square')"
            >
              <Square :size="12" /> Square
            </button>
          </div>
        </div>
      </div>
    </SheetContent>
  </Sheet>
</template>
