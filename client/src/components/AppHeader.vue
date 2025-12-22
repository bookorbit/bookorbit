<script setup lang="ts">
import { ref } from 'vue'
import { Search, SlidersHorizontal, LayoutGrid, List, X } from 'lucide-vue-next'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { Separator } from '@/components/ui/separator'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import AccentPicker from '@/components/AccentPicker.vue'
import RadiusPicker from '@/components/RadiusPicker.vue'
import ThemeToggle from '@/components/ThemeToggle.vue'

const props = defineProps<{
  title: string
  total: number
  loaded: number
  search: string
  coverSize: number
  gridGap: number
  viewMode: 'grid' | 'list'
}>()

const emit = defineEmits<{
  'update:search': [value: string]
  'update:coverSize': [value: number]
  'update:gridGap': [value: number]
  'update:viewMode': [value: 'grid' | 'list']
}>()

const searchFocused = ref(false)
</script>

<template>
  <header class="flex h-14 shrink-0 items-center gap-2 border-b border-primary/20 bg-background/90 backdrop-blur-md px-3 shadow-sm sticky top-0 z-10">
    <!-- Left: context -->
    <SidebarTrigger class="-ml-1 text-muted-foreground hover:text-foreground" />

    <Separator orientation="vertical" class="mx-1 h-4" />

    <div class="flex items-center gap-2">
      <span class="font-serif font-semibold text-[15px] text-foreground tracking-tight">{{ title }}</span>
      <span class="text-[11px] font-medium text-primary/70 bg-primary/8 px-2 py-0.5 rounded-full tabular-nums border border-primary/15">
        {{ loaded.toLocaleString() }}<span class="text-muted-foreground/60 mx-0.5">/</span>{{ total.toLocaleString() }}
      </span>
    </div>

    <!-- Right: actions -->
    <div class="ml-auto flex items-center gap-1">
      <!-- Search -->
      <div class="relative flex items-center transition-all duration-200" :class="searchFocused || props.search ? 'w-56' : 'w-44'">
        <Search class="absolute left-2.5 text-muted-foreground pointer-events-none" :size="13" />
        <input
          :value="props.search"
          @input="emit('update:search', ($event.target as HTMLInputElement).value)"
          @focus="searchFocused = true"
          @blur="searchFocused = false"
          placeholder="Search books..."
          class="w-full h-8 pl-8 pr-7 text-sm rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary transition-shadow"
        />
        <button v-if="props.search" @click="emit('update:search', '')" class="absolute right-2 text-muted-foreground hover:text-foreground">
          <X :size="13" />
        </button>
      </div>

      <Separator orientation="vertical" class="mx-1 h-4" />

      <!-- Display settings -->
      <Popover>
        <PopoverTrigger as-child>
          <Button variant="ghost" size="icon" class="h-8 w-8 text-muted-foreground hover:text-foreground">
            <SlidersHorizontal :size="15" />
          </Button>
        </PopoverTrigger>
        <PopoverContent class="w-64 p-4" align="end">
          <div class="space-y-4">
            <p class="text-xs font-semibold text-foreground uppercase tracking-wider">Display</p>

            <!-- Cover size -->
            <div class="space-y-1.5">
              <div class="flex items-center justify-between">
                <span class="text-xs text-muted-foreground">Cover size</span>
                <span class="text-xs font-medium tabular-nums text-foreground">{{ props.coverSize }}px</span>
              </div>
              <input
                :value="props.coverSize"
                @input="emit('update:coverSize', Number(($event.target as HTMLInputElement).value))"
                type="range"
                min="80"
                max="280"
                step="10"
                class="w-full accent-primary cursor-pointer"
              />
            </div>

            <!-- Grid gap -->
            <div class="space-y-1.5">
              <div class="flex items-center justify-between">
                <span class="text-xs text-muted-foreground">Grid gap</span>
                <span class="text-xs font-medium tabular-nums text-foreground">{{ props.gridGap }}px</span>
              </div>
              <input
                :value="props.gridGap"
                @input="emit('update:gridGap', Number(($event.target as HTMLInputElement).value))"
                type="range"
                min="4"
                max="40"
                step="4"
                class="w-full accent-primary cursor-pointer"
              />
            </div>

            <Separator />

            <!-- Accent -->
            <div class="space-y-1.5">
              <span class="text-xs text-muted-foreground">Accent</span>
              <AccentPicker />
            </div>

            <!-- Radius -->
            <div class="space-y-1.5">
              <span class="text-xs text-muted-foreground">Radius</span>
              <RadiusPicker />
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <!-- View toggle -->
      <Button
        variant="ghost"
        size="icon"
        class="h-8 w-8"
        :class="props.viewMode === 'grid' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'"
        @click="emit('update:viewMode', 'grid')"
      >
        <LayoutGrid :size="15" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        class="h-8 w-8"
        :class="props.viewMode === 'list' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'"
        @click="emit('update:viewMode', 'list')"
      >
        <List :size="15" />
      </Button>

      <Separator orientation="vertical" class="mx-1 h-4" />

      <ThemeToggle />
    </div>
  </header>
</template>
