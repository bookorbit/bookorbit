<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ArrowLeft, LayoutGrid, List, Moon, MoreHorizontal, Search, SlidersHorizontal, Sun, X } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { Separator } from '@/components/ui/separator'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import AccentPicker from '@/components/AccentPicker.vue'
import RadiusPicker from '@/components/RadiusPicker.vue'
import ThemeToggle from '@/components/ThemeToggle.vue'
import { useThemeStore } from '@/stores/theme'
import { useGlobalSearch, type GlobalSearchResult } from '@/features/book/composables/useGlobalSearch'
import BookCoverImage from '@/features/book/components/BookCoverImage.vue'

const props = defineProps<{
  title: string
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

const router = useRouter()
const themeStore = useThemeStore()

const searchFocused = ref(false)
const mobileSearchOpen = ref(false)
const mobileDisplayOpen = ref(false)
const mobileSearchInput = ref<HTMLInputElement | null>(null)

const globalSearchQuery = ref('')
const { results: globalResults, loading: globalSearchLoading, clear: clearGlobalSearch } = useGlobalSearch(globalSearchQuery)

const showDropdown = computed(
  () =>
    (searchFocused.value || mobileSearchOpen.value) &&
    globalSearchQuery.value.trim().length >= 2 &&
    (globalResults.value.length > 0 || globalSearchLoading.value),
)

watch(mobileSearchOpen, (open) => {
  if (open) nextTick(() => mobileSearchInput.value?.focus())
})

function clearSearch() {
  globalSearchQuery.value = ''
  clearGlobalSearch()
}

function closeMobileSearch() {
  mobileSearchOpen.value = false
  clearSearch()
}

function navigateToResult(result: GlobalSearchResult) {
  clearSearch()
  mobileSearchOpen.value = false
  router.push({ name: 'library', params: { id: result.libraryId } })
}
</script>

<template>
  <header class="flex h-14 shrink-0 items-center gap-2 border-b border-primary/20 bg-background/90 backdrop-blur-md px-3 shadow-sm sticky top-0 z-10">
    <!-- Mobile: search active overlay -->
    <template v-if="mobileSearchOpen">
      <Button variant="ghost" size="icon" class="h-8 w-8 shrink-0" @click="closeMobileSearch()">
        <ArrowLeft :size="16" />
      </Button>
      <div class="flex-1 relative flex items-center">
        <Search class="absolute left-2.5 text-muted-foreground pointer-events-none" :size="13" />
        <input
          ref="mobileSearchInput"
          v-model="globalSearchQuery"
          @keydown.esc="clearSearch()"
          placeholder="Search all books..."
          class="w-full h-8 pl-8 pr-7 text-sm rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary transition-shadow"
        />
        <button v-if="globalSearchQuery" @click="clearSearch()" class="absolute right-2 text-muted-foreground hover:text-foreground">
          <X :size="13" />
        </button>

        <!-- Mobile search dropdown -->
        <div
          v-if="showDropdown"
          @mousedown.prevent
          class="absolute top-full left-0 right-0 mt-1 bg-background border border-border rounded-md shadow-lg z-50 overflow-hidden max-h-72 overflow-y-auto"
        >
          <div v-if="globalSearchLoading && globalResults.length === 0" class="p-3 text-xs text-muted-foreground text-center">Searching...</div>
          <div v-else-if="!globalSearchLoading && globalResults.length === 0" class="p-3 text-xs text-muted-foreground text-center">No results</div>
          <button
            v-for="result in globalResults"
            :key="result.id"
            @click="navigateToResult(result)"
            class="w-full flex items-center gap-3 px-3 py-2 hover:bg-accent transition-colors text-left"
          >
            <BookCoverImage :book-id="result.id" type="thumbnail" class="h-11 w-8 object-cover rounded shrink-0 bg-muted" :alt="result.title ?? ''" />
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-foreground truncate">{{ result.title ?? 'Untitled' }}</p>
              <p v-if="result.authors.length" class="text-xs text-muted-foreground truncate">{{ result.authors.join(', ') }}</p>
            </div>
            <span
              class="text-[10px] font-medium text-primary/70 bg-primary/8 px-1.5 py-0.5 rounded-full border border-primary/15 shrink-0 max-w-[80px] truncate"
            >
              {{ result.libraryName }}
            </span>
          </button>
        </div>
      </div>
    </template>

    <!-- Normal state -->
    <template v-else>
      <!-- Left: sidebar trigger + library context -->
      <SidebarTrigger class="-ml-1 text-muted-foreground hover:text-foreground" />
      <Separator orientation="vertical" class="mx-1 h-4" />
      <div class="flex items-center gap-2 min-w-0">
        <span class="font-serif font-semibold text-[15px] text-foreground tracking-tight truncate">
          {{ title }}
        </span>
        <span
          class="hidden md:inline-flex text-[11px] font-medium text-primary/70 bg-primary/8 px-2 py-0.5 rounded-full tabular-nums border border-primary/15 shrink-0"
        >
          {{ loaded.toLocaleString() }}<span class="text-muted-foreground/60 mx-0.5">/</span>{{ total.toLocaleString() }}
        </span>
      </div>

      <!-- Center: desktop global search -->
      <div
        class="hidden md:flex flex-1 mx-4 relative items-center transition-all duration-200"
        :class="searchFocused || globalSearchQuery ? 'max-w-sm' : 'max-w-xs'"
      >
        <Search class="absolute left-2.5 text-muted-foreground pointer-events-none" :size="13" />
        <input
          v-model="globalSearchQuery"
          @focus="searchFocused = true"
          @blur="searchFocused = false"
          @keydown.esc="clearSearch()"
          placeholder="Search all books..."
          class="w-full h-8 pl-8 pr-7 text-sm rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary transition-shadow"
        />
        <button v-if="globalSearchQuery" @click="clearSearch()" class="absolute right-2 text-muted-foreground hover:text-foreground">
          <X :size="13" />
        </button>

        <!-- Desktop search dropdown -->
        <div
          v-if="showDropdown"
          @mousedown.prevent
          class="absolute top-full left-0 right-0 mt-1 bg-background border border-border rounded-md shadow-lg z-50 overflow-hidden max-h-72 overflow-y-auto"
        >
          <div v-if="globalSearchLoading && globalResults.length === 0" class="p-3 text-xs text-muted-foreground text-center">Searching...</div>
          <div v-else-if="!globalSearchLoading && globalResults.length === 0" class="p-3 text-xs text-muted-foreground text-center">No results</div>
          <button
            v-for="result in globalResults"
            :key="result.id"
            @click="navigateToResult(result)"
            class="w-full flex items-center gap-3 px-3 py-2 hover:bg-accent transition-colors text-left"
          >
            <BookCoverImage :book-id="result.id" type="thumbnail" class="h-11 w-8 object-cover rounded shrink-0 bg-muted" :alt="result.title ?? ''" />
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-foreground truncate">{{ result.title ?? 'Untitled' }}</p>
              <p v-if="result.authors.length" class="text-xs text-muted-foreground truncate">{{ result.authors.join(', ') }}</p>
            </div>
            <span
              class="text-[10px] font-medium text-primary/70 bg-primary/8 px-1.5 py-0.5 rounded-full border border-primary/15 shrink-0 max-w-[80px] truncate"
            >
              {{ result.libraryName }}
            </span>
          </button>
        </div>
      </div>

      <!-- Right: actions -->
      <div class="ml-auto flex items-center gap-1">
        <!-- Mobile: search icon -->
        <Button variant="ghost" size="icon" class="md:hidden h-8 w-8 text-muted-foreground hover:text-foreground" @click="mobileSearchOpen = true">
          <Search :size="15" />
        </Button>

        <!-- Desktop: view toggle -->
        <div class="hidden md:flex items-center">
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
        </div>

        <Separator orientation="vertical" class="hidden md:block mx-1 h-4" />

        <!-- Desktop: display settings popover -->
        <Popover>
          <PopoverTrigger as-child>
            <Button variant="ghost" size="icon" class="hidden md:flex h-8 w-8 text-muted-foreground hover:text-foreground">
              <SlidersHorizontal :size="15" />
            </Button>
          </PopoverTrigger>
          <PopoverContent class="w-64 p-4" align="end">
            <div class="space-y-4">
              <p class="text-xs font-semibold text-foreground uppercase tracking-wider">Display</p>
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
              <div class="space-y-1.5">
                <span class="text-xs text-muted-foreground">Accent</span>
                <AccentPicker />
              </div>
              <div class="space-y-1.5">
                <span class="text-xs text-muted-foreground">Radius</span>
                <RadiusPicker />
              </div>
            </div>
          </PopoverContent>
        </Popover>

        <Separator orientation="vertical" class="hidden md:block mx-1 h-4" />

        <!-- Desktop: theme toggle -->
        <div class="hidden md:flex">
          <ThemeToggle />
        </div>

        <!-- Mobile: overflow dropdown -->
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="icon" class="md:hidden h-8 w-8 text-muted-foreground hover:text-foreground">
              <MoreHorizontal :size="15" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-44">
            <DropdownMenuLabel class="text-xs text-muted-foreground">View</DropdownMenuLabel>
            <DropdownMenuRadioGroup :model-value="props.viewMode" @update:model-value="emit('update:viewMode', $event as 'grid' | 'list')">
              <DropdownMenuRadioItem value="grid">Grid</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="list">List</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem @click="mobileDisplayOpen = true">
              <SlidersHorizontal :size="14" class="mr-2" />
              Display
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem @click="themeStore.toggleTheme()">
              <component :is="themeStore.theme === 'dark' ? Sun : Moon" :size="14" class="mr-2" />
              {{ themeStore.theme === 'dark' ? 'Light mode' : 'Dark mode' }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </template>
  </header>

  <!-- Mobile display settings sheet (portaled to body) -->
  <Sheet v-model:open="mobileDisplayOpen">
    <SheetContent side="bottom">
      <SheetHeader>
        <SheetTitle>Display</SheetTitle>
      </SheetHeader>
      <div class="space-y-4 px-4 pb-6">
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
        <div class="space-y-1.5">
          <span class="text-xs text-muted-foreground">Accent</span>
          <AccentPicker />
        </div>
        <div class="space-y-1.5">
          <span class="text-xs text-muted-foreground">Radius</span>
          <RadiusPicker />
        </div>
      </div>
    </SheetContent>
  </Sheet>
</template>
