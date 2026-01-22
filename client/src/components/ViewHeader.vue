<script setup lang="ts">
import { ref } from 'vue'
import { LayoutGrid, List, MoreHorizontal, SlidersHorizontal } from 'lucide-vue-next'
import * as LucideIcons from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
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

const props = defineProps<{
  title: string
  icon?: string
  total: number
  loaded: number
  coverSize: number
  gridGap: number
  viewMode: 'grid' | 'list'
}>()

const emit = defineEmits<{
  'update:coverSize': [value: number]
  'update:gridGap': [value: number]
  'update:viewMode': [value: 'grid' | 'list']
}>()

const mobileDisplayOpen = ref(false)

function getIconComponent(name: string) {
  return (LucideIcons as Record<string, unknown>)[name] ?? null
}
</script>

<template>
  <div class="flex h-11 shrink-0 items-center gap-2 border-b border-border/60 bg-card/40 px-4">
    <!-- Left: optional icon + title + count -->
    <div class="flex items-center gap-2 flex-1 min-w-0">
      <component v-if="icon" :is="getIconComponent(icon)" :size="15" class="shrink-0 text-muted-foreground" />
      <span class="font-semibold text-[14px] text-foreground tracking-tight truncate">{{ title }}</span>
      <span
        class="hidden sm:inline-flex text-[11px] font-medium text-primary/70 bg-primary/8 px-2 py-0.5 rounded-full tabular-nums border border-primary/15 shrink-0"
      >
        {{ loaded.toLocaleString() }}<span class="text-muted-foreground/60 mx-0.5">/</span>{{ total.toLocaleString() }}
      </span>
    </div>

    <!-- Right -->
    <div class="flex items-center gap-2 shrink-0">
      <slot name="toolbar" />
      <slot name="actions" />

      <!-- Desktop: view mode toggle -->
      <div class="hidden md:flex items-center">
        <Button
          variant="ghost"
          size="icon"
          class="h-8 w-8"
          :class="viewMode === 'grid' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'"
          @click="emit('update:viewMode', 'grid')"
        >
          <LayoutGrid :size="15" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="h-8 w-8"
          :class="viewMode === 'list' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'"
          @click="emit('update:viewMode', 'list')"
        >
          <List :size="15" />
        </Button>
      </div>

      <Separator orientation="vertical" class="hidden md:block mx-1 h-4" />

      <!-- Desktop: display settings popover -->
      <Popover>
        <PopoverTrigger as-child>
          <Button variant="ghost" size="icon" class="hidden md:flex h-8 w-8 text-muted-foreground hover:text-foreground">
            <SlidersHorizontal :size="15" />
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
