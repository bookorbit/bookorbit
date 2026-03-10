<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { ArrowLeft, Search, Palette, Upload, X, KeyRound, Settings, LogOut } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { Separator } from '@/components/ui/separator'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import AccentPicker from '@/components/AccentPicker.vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import RadiusPicker from '@/components/RadiusPicker.vue'
import BackgroundPicker from '@/components/BackgroundPicker.vue'
import ThemePicker from '@/components/ThemePicker.vue'
import { useGlobalSearch, type GlobalSearchResult } from '@/features/book/composables/useGlobalSearch'
import BookCoverImage from '@/features/book/components/BookCoverImage.vue'
import { useAuth } from '@/features/auth/composables/useAuth'
import { useChangePasswordDialog } from '@/composables/useChangePasswordDialog'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import BookUploadModal from '@/features/library/components/BookUploadModal.vue'

const router = useRouter()
const { user, logout } = useAuth()
const { open: openChangePassword } = useChangePasswordDialog()
const { hasPermission } = usePermissions()

const uploadOpen = ref(false)

const searchFocused = ref(false)
const mobileSearchOpen = ref(false)
const desktopSearchInput = ref<HTMLInputElement | null>(null)
const mobileSearchInput = ref<HTMLInputElement | null>(null)
const selectedIndex = ref(-1)

const globalSearchQuery = ref('')
const {
  results: globalResults,
  loading: globalSearchLoading,
  settled: globalSearchSettled,
  clear: clearGlobalSearch,
} = useGlobalSearch(globalSearchQuery)

const showDropdown = computed(
  () =>
    (searchFocused.value || mobileSearchOpen.value) &&
    globalSearchQuery.value.trim().length >= 2 &&
    (globalResults.value.length > 0 || globalSearchLoading.value || globalSearchSettled.value),
)

function onSearchBlur() {
  searchFocused.value = false
  selectedIndex.value = -1
}

watch(globalSearchQuery, () => {
  selectedIndex.value = -1
})

watch(showDropdown, (open) => {
  if (!open) selectedIndex.value = -1
})

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
  router.push({ name: 'book-detail', params: { bookId: result.id } })
}

function handleSearchKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    clearSearch()
    return
  }
  if (!showDropdown.value) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedIndex.value = Math.min(selectedIndex.value + 1, globalResults.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedIndex.value = Math.max(selectedIndex.value - 1, -1)
  } else if (e.key === 'Enter' && selectedIndex.value >= 0) {
    const result = globalResults.value[selectedIndex.value]
    if (result) navigateToResult(result)
  }
}

function handleGlobalKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault()
    desktopSearchInput.value?.focus()
  }
}

onMounted(() => window.addEventListener('keydown', handleGlobalKeydown))
onUnmounted(() => window.removeEventListener('keydown', handleGlobalKeydown))

function highlightSegments(text: string | null, query: string) {
  if (!text || !query.trim()) return [{ text: text ?? '', match: false }]
  const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'))
  const lower = query.trim().toLowerCase()
  return parts.map((part) => ({ text: part, match: part.toLowerCase() === lower }))
}

function formatBadgeClass(fmt: string): string {
  switch (fmt.toLowerCase()) {
    case 'epub':
      return 'bg-blue-500/10 text-blue-500 border-blue-500/20'
    case 'pdf':
      return 'bg-red-500/10 text-red-500 border-red-500/20'
    case 'mobi':
    case 'azw3':
      return 'bg-amber-500/10 text-amber-600 border-amber-500/20'
    case 'cbz':
    case 'cbr':
      return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
    default:
      return 'bg-muted text-muted-foreground border-border'
  }
}
</script>

<template>
  <header
    class="flex h-12 shrink-0 items-center gap-2 border border-sidebar-border/50 bg-background/90 backdrop-blur-xl px-3 shadow-lg shadow-black/5 relative mt-3 ml-0 mr-4 z-30 rounded-xl transition-all duration-300 flex-none"
  >
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
          @keydown="handleSearchKeydown"
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
          <div
            v-else-if="globalSearchSettled && !globalSearchLoading && globalResults.length === 0"
            class="p-3 text-xs text-muted-foreground text-center"
          >
            No results
          </div>
          <button
            v-for="(result, index) in globalResults"
            :key="result.id"
            @click="navigateToResult(result)"
            :class="[
              'w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left border-b border-border/40 last:border-b-0',
              selectedIndex === index ? 'bg-accent' : 'hover:bg-accent/60',
            ]"
          >
            <BookCoverImage
              :book-id="result.id"
              type="thumbnail"
              class="h-16 w-12 object-cover rounded shrink-0 bg-muted"
              :alt="result.title ?? ''"
            />
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-foreground truncate">
                <template v-for="seg in highlightSegments(result.title, globalSearchQuery)" :key="seg.text + seg.match">
                  <span v-if="seg.match" class="bg-primary/20 text-foreground font-semibold rounded-sm px-0.5">{{ seg.text }}</span>
                  <span v-else>{{ seg.text }}</span>
                </template>
              </p>
              <p v-if="result.authors.length" class="text-xs text-muted-foreground truncate mt-0.5">
                <template v-for="seg in highlightSegments(result.authors.join(', '), globalSearchQuery)" :key="seg.text + seg.match">
                  <span v-if="seg.match" class="bg-primary/20 text-foreground font-semibold rounded-sm px-0.5">{{ seg.text }}</span>
                  <span v-else>{{ seg.text }}</span>
                </template>
              </p>
              <p v-if="result.seriesName" class="text-xs text-muted-foreground/70 truncate mt-0.5 italic">
                <template v-for="seg in highlightSegments(result.seriesName, globalSearchQuery)" :key="seg.text + seg.match">
                  <span v-if="seg.match" class="bg-primary/20 text-foreground font-semibold rounded-sm px-0.5 not-italic">{{ seg.text }}</span>
                  <span v-else>{{ seg.text }}</span>
                </template>
              </p>
            </div>
            <div class="flex flex-col items-end gap-1 shrink-0">
              <span class="text-[10px] font-medium text-primary/70 bg-primary/8 px-1.5 py-0.5 rounded border border-primary/15 max-w-20 truncate">
                {{ result.libraryName }}
              </span>
              <div v-if="result.formats.length" class="flex gap-1">
                <span
                  v-for="fmt in result.formats"
                  :key="fmt"
                  :class="['text-[9px] font-semibold px-1 py-0.5 rounded border uppercase', formatBadgeClass(fmt)]"
                >
                  {{ fmt }}
                </span>
              </div>
            </div>
          </button>
        </div>
      </div>
    </template>

    <!-- Normal state -->
    <template v-else>
      <!-- Left: sidebar trigger -->
      <SidebarTrigger class="-ml-1 text-muted-foreground hover:text-foreground" />
      <Separator orientation="vertical" class="mx-1 h-4" />

      <!-- Center: desktop global search -->
      <div
        class="hidden md:flex flex-1 mx-4 relative items-center transition-all duration-300"
        :class="searchFocused || globalSearchQuery ? 'max-w-xl' : 'max-w-sm'"
      >
        <Search class="absolute left-3 text-muted-foreground/60 pointer-events-none" :size="14" />
        <input
          ref="desktopSearchInput"
          v-model="globalSearchQuery"
          @focus="searchFocused = true"
          @blur="onSearchBlur"
          @keydown="handleSearchKeydown"
          placeholder="Search all books..."
          class="w-full h-8 pl-9 pr-8 text-[13px] rounded-full border-none bg-primary/5 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1.5 focus:ring-primary/30 transition-all duration-300 shadow-inner shadow-black/5"
        />
        <div class="absolute right-2.5 flex items-center gap-1.5">
          <button v-if="globalSearchQuery" @click="clearSearch()" class="text-muted-foreground/60 hover:text-foreground transition-colors">
            <X :size="13" />
          </button>
          <kbd
            v-else
            class="hidden lg:inline-flex h-4.5 select-none items-center gap-1 rounded border border-sidebar-border/50 bg-background/50 px-1.5 font-mono text-[9px] font-medium text-muted-foreground/40 opacity-100"
          >
            <span class="text-xs">⌘</span>K
          </kbd>
        </div>

        <!-- Desktop search dropdown -->
        <div
          v-if="showDropdown"
          @mousedown.prevent
          class="absolute top-full left-0 right-0 mt-1 bg-background border border-border rounded-md shadow-lg z-50 overflow-hidden max-h-80 overflow-y-auto"
        >
          <div v-if="globalSearchLoading && globalResults.length === 0" class="p-3 text-xs text-muted-foreground text-center">Searching...</div>
          <div
            v-else-if="globalSearchSettled && !globalSearchLoading && globalResults.length === 0"
            class="p-3 text-xs text-muted-foreground text-center"
          >
            No results
          </div>
          <button
            v-for="(result, index) in globalResults"
            :key="result.id"
            @click="navigateToResult(result)"
            :class="[
              'w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left border-b border-border/40 last:border-b-0',
              selectedIndex === index ? 'bg-accent' : 'hover:bg-accent/60',
            ]"
          >
            <BookCoverImage
              :book-id="result.id"
              type="thumbnail"
              class="h-16 w-12 object-cover rounded shrink-0 bg-muted"
              :alt="result.title ?? ''"
            />
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-foreground truncate">
                <template v-for="seg in highlightSegments(result.title, globalSearchQuery)" :key="seg.text + seg.match">
                  <span v-if="seg.match" class="bg-primary/20 text-foreground font-semibold rounded-sm px-0.5">{{ seg.text }}</span>
                  <span v-else>{{ seg.text }}</span>
                </template>
              </p>
              <p v-if="result.authors.length" class="text-xs text-muted-foreground truncate mt-0.5">
                <template v-for="seg in highlightSegments(result.authors.join(', '), globalSearchQuery)" :key="seg.text + seg.match">
                  <span v-if="seg.match" class="bg-primary/20 text-foreground font-semibold rounded-sm px-0.5">{{ seg.text }}</span>
                  <span v-else>{{ seg.text }}</span>
                </template>
              </p>
              <p v-if="result.seriesName" class="text-xs text-muted-foreground/70 truncate mt-0.5 italic">
                <template v-for="seg in highlightSegments(result.seriesName, globalSearchQuery)" :key="seg.text + seg.match">
                  <span v-if="seg.match" class="bg-primary/20 text-foreground font-semibold rounded-sm px-0.5 not-italic">{{ seg.text }}</span>
                  <span v-else>{{ seg.text }}</span>
                </template>
              </p>
            </div>
            <div class="flex flex-col items-end gap-1 shrink-0">
              <span class="text-[10px] font-medium text-primary/70 bg-primary/8 px-1.5 py-0.5 rounded border border-primary/15 max-w-20 truncate">
                {{ result.libraryName }}
              </span>
              <div v-if="result.formats.length" class="flex gap-1">
                <span
                  v-for="fmt in result.formats"
                  :key="fmt"
                  :class="['text-[9px] font-semibold px-1 py-0.5 rounded border uppercase', formatBadgeClass(fmt)]"
                >
                  {{ fmt }}
                </span>
              </div>
            </div>
          </button>
        </div>
      </div>

      <!-- Right -->
      <div class="ml-auto flex items-center gap-0.5">
        <!-- Mobile: search icon -->
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              class="md:hidden h-8 w-8 text-muted-foreground hover:text-foreground"
              @click="mobileSearchOpen = true"
            >
              <Search :size="15" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Search</TooltipContent>
        </Tooltip>

        <!-- Upload button -->
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              v-if="hasPermission('library_upload')"
              variant="ghost"
              size="icon"
              class="hidden md:flex h-8 w-8 text-muted-foreground hover:text-foreground"
              @click="uploadOpen = true"
            >
              <Upload :size="15" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Upload books</TooltipContent>
        </Tooltip>

        <!-- Desktop: appearance settings popover -->
        <Tooltip>
          <Popover>
            <TooltipTrigger as-child>
              <PopoverTrigger as-child>
                <Button variant="ghost" size="icon" class="hidden md:flex h-8 w-8 text-muted-foreground hover:text-foreground">
                  <Palette :size="15" />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <PopoverContent class="w-72 p-4" align="end">
              <div class="space-y-4">
                <p class="text-xs font-semibold text-foreground uppercase tracking-wider">Appearance</p>
                <div class="space-y-1.5">
                  <span class="text-xs text-muted-foreground">Theme</span>
                  <ThemePicker />
                </div>
                <div class="space-y-1.5">
                  <span class="text-xs text-muted-foreground">Accent</span>
                  <AccentPicker />
                </div>
                <div class="space-y-1.5">
                  <span class="text-xs text-muted-foreground">Radius</span>
                  <RadiusPicker />
                </div>
                <div class="space-y-1.5">
                  <span class="text-xs text-muted-foreground">Background</span>
                  <BackgroundPicker />
                </div>
              </div>
            </PopoverContent>
          </Popover>
          <TooltipContent>Appearance</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              class="hidden md:flex h-8 w-8 text-muted-foreground hover:text-foreground"
              @click="router.push({ name: 'settings-libraries' })"
            >
              <Settings :size="15" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Settings</TooltipContent>
        </Tooltip>

        <!-- User avatar dropdown -->
        <DropdownMenu v-if="user">
          <DropdownMenuTrigger as-child>
            <button
              class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary text-xs font-semibold hover:bg-primary/25 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {{ user.name.charAt(0).toUpperCase() }}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-48">
            <DropdownMenuLabel class="font-normal">
              <div class="flex flex-col gap-0.5">
                <span class="text-xs font-medium text-foreground">{{ user.name }}</span>
                <span class="text-[10px] text-muted-foreground">{{ user.username }}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem @click="openChangePassword()">
              <KeyRound :size="13" class="mr-2 text-muted-foreground" />
              Change Password
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem @click="logout" class="text-destructive focus:text-destructive">
              <LogOut :size="13" class="mr-2" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </template>
  </header>

  <BookUploadModal v-if="uploadOpen" @close="uploadOpen = false" @uploaded="uploadOpen = false" />
</template>
