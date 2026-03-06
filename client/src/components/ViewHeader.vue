<script setup lang="ts">
import { ref } from 'vue'
import { CheckSquare, LayoutGrid, List, MoreHorizontal, SlidersHorizontal, Square } from 'lucide-vue-next'
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
  loaded: number
  coverSize: number
  gridGap: number
  viewMode: 'grid' | 'list'
  selectionMode?: boolean
}>()

const emit = defineEmits<{
  'update:coverSize': [value: number]
  'update:gridGap': [value: number]
  'update:viewMode': [value: 'grid' | 'list']
  'toggle-selection': []
}>()

const mobileDisplayOpen = ref(false)

function getIconComponent(name: string) {
  return (LucideIcons as Record<string, unknown>)[name] ?? null
}
</script>

<template>
  <div class="flex h-10 shrink-0 items-center gap-2 px-1 mr-4 mt-2 ml-0 mb-2 sticky top-0 z-20 transition-all duration-300">
    <!-- Left: optional icon + title + count -->
    <div class="flex items-center gap-2.5 flex-1 min-w-0">
      <div class="w-1 h-4 bg-primary/40 rounded-full" />
      <component v-if="icon" :is="getIconComponent(icon)" :size="14" class="shrink-0 text-muted-foreground/60" />
      <span class="font-bold text-[16px] text-foreground/90 tracking-tight truncate">{{ title }}</span>
      <span class="text-[12px] font-bold text-primary/60 tabular-nums uppercase tracking-wider ml-1">
        {{ loaded.toLocaleString() }}<span class="text-muted-foreground/30 mx-0.5 font-normal">/</span>{{ total.toLocaleString() }}
      </span>
    </div>

    <!-- Right -->
    <div class="flex items-center gap-1 shrink-0">
      <slot name="toolbar" />
      <div class="w-px h-3.5 bg-border/40 mx-1.5" />
      <slot name="actions" />

      <!-- Select mode toggle -->
      <Button
        variant="ghost"
        size="sm"
        class="hidden md:flex h-8 gap-1.5 text-[11px] font-bold uppercase tracking-tight px-2.5 rounded-lg transition-all"
        :class="
          selectionMode
            ? 'text-primary bg-primary/10 hover:bg-primary/20 ring-1 ring-primary/20'
            : 'text-muted-foreground/60 hover:text-foreground hover:bg-primary/5'
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
          :class="viewMode === 'grid' ? 'text-primary bg-primary/10' : 'text-muted-foreground/50 hover:text-foreground hover:bg-primary/5'"
          @click="emit('update:viewMode', 'grid')"
        >
          <LayoutGrid :size="14" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="h-8 w-8 rounded-lg"
          :class="viewMode === 'list' ? 'text-primary bg-primary/10' : 'text-muted-foreground/50 hover:text-foreground hover:bg-primary/5'"
          @click="emit('update:viewMode', 'list')"
        >
          <List :size="14" />
        </Button>
      </div>

      <div class="hidden md:block w-px h-3.5 bg-border/40 mx-1.5" />

      <!-- Desktop: display settings popover -->
      <Popover>
        <PopoverTrigger as-child>
          <Button
            variant="ghost"
            size="icon"
            class="hidden md:flex h-8 w-8 rounded-lg text-muted-foreground/50 hover:text-foreground hover:bg-primary/5"
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
                min="80"
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
            min="80"
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
      </div>
    </SheetContent>
  </Sheet>
</template>
