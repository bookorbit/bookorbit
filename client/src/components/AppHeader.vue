<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  ArrowLeft,
  Search,
  Palette,
  Upload,
  X,
  KeyRound,
  Settings,
  LogOut,
  PackageOpen,
  BarChart3,
  Trophy,
  User,
  MoreVertical,
  BadgeQuestionMark,
  Star,
  ExternalLink,
  Sparkles,
  Highlighter,
} from '@lucide/vue'
import { useRouter, useRoute } from 'vue-router'
import { toast } from 'vue-sonner'
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
import { useLibraryUploadEvents } from '@/features/library/composables/useLibraryUploadEvents'
import { useBookDockSummary } from '@/features/book-dock/composables/useBookDockSummary'
import NotificationSheet from '@/features/notifications/components/NotificationSheet.vue'
import { useNotifications } from '@/features/notifications/composables/useNotifications'
import { useWhatsNew } from '@/features/whats-new/composables/useWhatsNew'
import UserAvatar from '@/components/UserAvatar.vue'
import { DEFAULT_FORMAT_PRIORITY } from '@bookorbit/types'
import { useThemeStore } from '@/stores/theme'
import { getFormatColor } from '@/features/book/lib/format-colors'

const router = useRouter()
const route = useRoute()
const { user, logout } = useAuth()
const { open: openChangePassword } = useChangePasswordDialog()
const { hasPermission, isDemoRestrictedAccount } = usePermissions()
const { onLibraryUploadCompleted } = useLibraryUploadEvents()
const { summary: bookDockSummary, fetchSummary: fetchBookDockSummary, subscribe: subscribeBookDockSummary } = useBookDockSummary()
const { subscribe: subscribeNotifications } = useNotifications()
const { hasUnseen: hasUnseenWhatsNew } = useWhatsNew()
const themeStore = useThemeStore()
const documentationUrl = 'https://bookorbit.app/what-is-bookorbit.html'
const githubRepositoryUrl = 'https://github.com/bookorbit/bookorbit'
const githubStarPopoverOpen = ref(false)

const isBookDockActive = computed(() => route.name === 'book-dock')
const isAchievementsActive = computed(() => route.name === 'achievements')
const isStatisticsActive = computed(() => route.name === 'statistics')
const isAnnotationsActive = computed(() => route.name === 'annotations')

const iconRadiusClass = computed(() => (themeStore.radius === 'sharp' ? 'rounded-none' : 'rounded-full'))
const canChangePassword = computed(
  () => !isDemoRestrictedAccount.value && user.value?.provisioningMethod !== 'oidc' && user.value?.provisioningMethod !== 'shared',
)
const canAccessNotifications = computed(() => hasPermission('notification_access') && !isDemoRestrictedAccount.value)

function navigateToBookDock() {
  router.push({ name: 'book-dock' })
}

function navigateToStatistics() {
  router.push({ name: 'statistics', query: { tab: 'library' } })
}

function navigateToAnnotations() {
  router.push({ name: 'annotations' })
}

function navigateToAchievements() {
  router.push({ name: 'achievements' })
}

function navigateToAccount() {
  router.push({ name: 'settings-account' })
}

function navigateToSettings() {
  router.push({ name: 'settings-libraries' })
}

function navigateToWhatsNew() {
  router.push({ name: 'whats-new' })
}

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

function handleGithubStarPopoverOpenChange(open: boolean) {
  githubStarPopoverOpen.value = open
}

function closeGithubStarPopover() {
  githubStarPopoverOpen.value = false
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

onMounted(() => {
  window.addEventListener('keydown', handleGlobalKeydown)
  if (hasPermission('book_dock_access')) {
    fetchBookDockSummary()
    subscribeBookDockSummary()
  }
  if (canAccessNotifications.value) {
    subscribeNotifications()
  }
})

const stopLibraryUploadListener = onLibraryUploadCompleted((event) => {
  if (event.uploadedCount === 0 && event.failedCount === 0) return

  const uploadedLabel = `${event.uploadedCount} book${event.uploadedCount === 1 ? '' : 's'}`
  const failedLabel = `${event.failedCount} file${event.failedCount === 1 ? '' : 's'}`

  if (event.failedCount === 0) {
    toast.success(`Uploaded ${uploadedLabel}`)
    return
  }
  if (event.uploadedCount === 0) {
    toast.error(`Upload failed for ${failedLabel}`)
    return
  }

  toast.warning(`Uploaded ${uploadedLabel}, ${failedLabel} failed`)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeydown)
  stopLibraryUploadListener()
})

function highlightSegments(text: string | null, query: string) {
  if (!text || !query.trim()) return [{ text: text ?? '', match: false }]
  const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'))
  const lower = query.trim().toLowerCase()
  return parts.map((part) => ({ text: part, match: part.toLowerCase() === lower }))
}

function sortFormats(formats: string[]): string[] {
  return [...formats].sort((a, b) => {
    const aIndex = (DEFAULT_FORMAT_PRIORITY as readonly string[]).indexOf(a.toLowerCase())
    const bIndex = (DEFAULT_FORMAT_PRIORITY as readonly string[]).indexOf(b.toLowerCase())

    if (aIndex === -1 && bIndex === -1) return a.localeCompare(b)
    if (aIndex === -1) return 1
    if (bIndex === -1) return -1
    return aIndex - bIndex
  })
}

function formatBadgeStyle(fmt: string) {
  const color = getFormatColor(fmt)
  return {
    color,
    backgroundColor: `${color}1A`, // 10% opacity in hex
    borderColor: `${color}33`, // ~20% opacity in hex
  }
}
</script>

<template>
  <header
    class="flex h-12 shrink-0 items-center gap-2 border border-sidebar-border/50 bg-background/90 backdrop-blur-xl px-2 sm:px-3 shadow-lg shadow-black/5 relative mt-2 sm:mt-3 mx-2 sm:mx-4 z-30 rounded-lg transition-all duration-300 flex-none"
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
        <Transition name="search-drop">
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
                :version="result.updatedAt"
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
                <p v-if="result.seriesName" class="text-xs text-muted-foreground/85 truncate mt-0.5 italic">
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
                    v-for="fmt in sortFormats(result.formats)"
                    :key="fmt"
                    :class="['text-[9px] font-semibold px-1 py-0.5 rounded border uppercase']"
                    :style="formatBadgeStyle(fmt)"
                  >
                    {{ fmt }}
                  </span>
                </div>
              </div>
            </button>
          </div>
        </Transition>
      </div>
    </template>

    <!-- Normal state -->
    <template v-else>
      <!-- Left: sidebar trigger -->
      <SidebarTrigger :class="['-ml-1 text-foreground/70 hover:text-foreground', iconRadiusClass]" />
      <Separator orientation="vertical" class="mx-1 h-4" />

      <!-- Center: desktop global search -->
      <div
        data-tour="global-search"
        class="hidden md:flex flex-1 mx-4 relative items-center transition-all duration-300"
        :class="searchFocused || globalSearchQuery ? 'max-w-xl' : 'max-w-sm'"
      >
        <Search class="absolute left-3 text-muted-foreground/80 pointer-events-none" :size="14" />
        <input
          ref="desktopSearchInput"
          v-model="globalSearchQuery"
          @focus="searchFocused = true"
          @blur="onSearchBlur"
          @keydown="handleSearchKeydown"
          placeholder="Search all books..."
          class="w-full h-8 pl-9 pr-8 text-[13.5px] rounded-full border-none bg-primary/5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1.5 focus:ring-primary/30 transition-all duration-300 shadow-inner shadow-black/5"
        />
        <div class="absolute inset-y-0 right-2.5 flex items-center gap-1.5">
          <button
            v-if="globalSearchQuery"
            @click="clearSearch()"
            class="flex items-center justify-center text-muted-foreground/75 hover:text-foreground transition-colors"
          >
            <X :size="13" />
          </button>
          <kbd
            v-else
            class="hidden lg:inline-flex h-5.5 select-none items-center gap-1 rounded border border-sidebar-border/50 bg-background/50 px-2 font-mono text-[11px] font-bold text-muted-foreground/85 opacity-100"
          >
            <span class="text-[16px] leading-none">⌘</span>
            <span class="text-[12px] leading-none">K</span>
          </kbd>
        </div>

        <!-- Desktop search dropdown -->
        <Transition name="search-drop">
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
                :version="result.updatedAt"
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
                <p v-if="result.seriesName" class="text-xs text-muted-foreground/85 truncate mt-0.5 italic">
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
                    v-for="fmt in sortFormats(result.formats)"
                    :key="fmt"
                    :class="['text-[9px] font-semibold px-1 py-0.5 rounded border uppercase']"
                    :style="formatBadgeStyle(fmt)"
                  >
                    {{ fmt }}
                  </span>
                </div>
              </div>
            </button>
          </div>
        </Transition>
      </div>

      <!-- Right -->
      <div class="ml-auto flex items-center gap-3">
        <!-- Mobile: search icon -->
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              :class="[
                'md:hidden h-8 w-8 border border-primary/35 text-foreground/70 hover:border-primary/70 hover:text-foreground transition-colors',
                iconRadiusClass,
              ]"
              @click="mobileSearchOpen = true"
            >
              <Search :size="15" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Search</TooltipContent>
        </Tooltip>

        <!-- Mobile: Notifications bell -->
        <div class="md:hidden">
          <NotificationSheet v-if="canAccessNotifications" :icon-radius-class="iconRadiusClass" />
        </div>

        <!-- Mobile: Kebab Menu -->
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              :class="[
                'md:hidden h-8 w-8 border border-primary/35 text-foreground/70 hover:border-primary/70 hover:text-foreground transition-colors',
                iconRadiusClass,
              ]"
            >
              <MoreVertical :size="15" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-44">
            <DropdownMenuItem v-if="hasPermission('book_dock_access')" @click="navigateToBookDock">
              <PackageOpen :size="15" class="mr-2 text-muted-foreground" />
              Book Dock
              <span
                v-if="bookDockSummary.total > 0"
                class="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground tabular-nums leading-none"
              >
                {{ bookDockSummary.total }}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem @click="navigateToStatistics">
              <BarChart3 :size="15" class="mr-2 text-muted-foreground" />
              Statistics
            </DropdownMenuItem>
            <DropdownMenuItem @click="navigateToAchievements">
              <Trophy :size="15" class="mr-2 text-muted-foreground" />
              Achievements
            </DropdownMenuItem>
            <DropdownMenuItem v-if="hasPermission('library_upload')" @click="uploadOpen = true">
              <Upload :size="15" class="mr-2 text-muted-foreground" />
              Upload books
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Palette :size="15" class="mr-2 text-muted-foreground" />
                Appearance
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent class="w-72 p-4">
                <div class="space-y-4">
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
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuItem @click="navigateToSettings">
              <Settings :size="15" class="mr-2 text-muted-foreground" />
              Settings
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem @click="navigateToWhatsNew">
              <Sparkles :size="15" class="mr-2 text-muted-foreground" />
              What's New
              <span v-if="hasUnseenWhatsNew" class="ml-auto h-1.5 w-1.5 rounded-full bg-primary" aria-label="New" />
            </DropdownMenuItem>
            <DropdownMenuItem as-child>
              <a :href="documentationUrl" target="_blank" rel="noopener noreferrer">
                <BadgeQuestionMark :size="15" class="mr-2 text-muted-foreground" />
                Documentation
                <ExternalLink :size="12" class="ml-auto text-muted-foreground" />
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <!-- Group 1: Content (Book Dock, Statistics, Upload) -->
        <div class="hidden md:flex items-center gap-2.5">
          <!-- Book Dock button -->
          <Tooltip v-if="hasPermission('book_dock_access')">
            <TooltipTrigger as-child>
              <Button
                data-tour="book-dock-btn"
                variant="ghost"
                size="icon"
                class="relative h-8 w-8 border transition-colors"
                :class="[
                  isBookDockActive
                    ? 'border-primary/80 bg-primary/8 text-primary'
                    : 'border-primary/35 text-foreground/70 hover:border-primary/70 hover:text-foreground',
                  iconRadiusClass,
                ]"
                @click="navigateToBookDock"
              >
                <PackageOpen :size="15" />
                <span
                  v-if="bookDockSummary.total > 0"
                  class="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground tabular-nums leading-none"
                >
                  {{ bookDockSummary.total }}
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Book Dock</TooltipContent>
          </Tooltip>

          <!-- Notifications button -->
          <NotificationSheet v-if="canAccessNotifications" :icon-radius-class="iconRadiusClass" />

          <!-- Annotations button -->
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="ghost"
                size="icon"
                class="h-8 w-8 border transition-colors"
                :class="[
                  isAnnotationsActive
                    ? 'border-primary/80 bg-primary/8 text-primary'
                    : 'border-primary/35 text-foreground/70 hover:border-primary/70 hover:text-foreground',
                  iconRadiusClass,
                ]"
                @click="navigateToAnnotations"
              >
                <Highlighter :size="15" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Annotations</TooltipContent>
          </Tooltip>

          <!-- Statistics button -->
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                data-tour="statistics-btn"
                variant="ghost"
                size="icon"
                class="h-8 w-8 border transition-colors"
                :class="[
                  isStatisticsActive
                    ? 'border-primary/80 bg-primary/8 text-primary'
                    : 'border-primary/35 text-foreground/70 hover:border-primary/70 hover:text-foreground',
                  iconRadiusClass,
                ]"
                @click="navigateToStatistics"
              >
                <BarChart3 :size="15" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Statistics</TooltipContent>
          </Tooltip>

          <!-- Achievements button -->
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="ghost"
                size="icon"
                class="h-8 w-8 border transition-colors"
                :class="[
                  isAchievementsActive
                    ? 'border-primary/80 bg-primary/8 text-primary'
                    : 'border-primary/35 text-foreground/70 hover:border-primary/70 hover:text-foreground',
                  iconRadiusClass,
                ]"
                @click="navigateToAchievements"
              >
                <Trophy :size="15" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Achievements</TooltipContent>
          </Tooltip>

          <!-- Upload button -->
          <Tooltip v-if="hasPermission('library_upload')">
            <TooltipTrigger as-child>
              <Button
                data-tour="upload-button"
                variant="ghost"
                size="icon"
                :class="[
                  'h-8 w-8 border border-primary/35 text-foreground/70 hover:border-primary/70 hover:text-foreground transition-colors',
                  iconRadiusClass,
                ]"
                @click="uploadOpen = true"
              >
                <Upload :size="15" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Upload books</TooltipContent>
          </Tooltip>
        </div>

        <!-- Group 2: Preferences (Appearance, Settings) -->
        <div class="hidden md:block h-4 w-px bg-foreground/20" />
        <div class="hidden md:flex items-center gap-2.5">
          <Tooltip>
            <DropdownMenu>
              <TooltipTrigger as-child>
                <DropdownMenuTrigger as-child>
                  <Button
                    data-tour="documentation-link"
                    variant="ghost"
                    size="icon"
                    :class="[
                      'relative h-8 w-8 border border-primary/35 text-foreground/70 hover:border-primary/70 hover:text-foreground transition-colors',
                      iconRadiusClass,
                    ]"
                  >
                    <BadgeQuestionMark :size="15" />
                    <span
                      v-if="hasUnseenWhatsNew"
                      class="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary ring-2 ring-background"
                      aria-label="New release notes available"
                    />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <DropdownMenuContent align="end" class="w-48">
                <DropdownMenuItem as-child>
                  <a :href="documentationUrl" target="_blank" rel="noopener noreferrer">
                    <BadgeQuestionMark :size="14" class="mr-2 text-muted-foreground" />
                    Documentation
                    <ExternalLink :size="12" class="ml-auto text-muted-foreground" />
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem @click="navigateToWhatsNew">
                  <Sparkles :size="14" class="mr-2 text-muted-foreground" />
                  What's New
                  <span v-if="hasUnseenWhatsNew" class="ml-auto h-1.5 w-1.5 rounded-full bg-primary" aria-label="New" />
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <TooltipContent>Help</TooltipContent>
          </Tooltip>

          <Tooltip>
            <Popover :open="githubStarPopoverOpen" @update:open="handleGithubStarPopoverOpenChange">
              <TooltipTrigger as-child>
                <PopoverTrigger as-child>
                  <Button
                    data-tour="github-star-cta"
                    variant="ghost"
                    size="icon"
                    :class="[
                      'h-8 w-8 border border-primary/35 text-foreground/70 hover:border-primary/70 hover:text-foreground transition-colors',
                      iconRadiusClass,
                    ]"
                  >
                    <Star :size="15" />
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <PopoverContent side="bottom" align="end" class="relative w-80 p-4">
                <Button
                  variant="ghost"
                  size="icon"
                  class="absolute right-2 top-2 h-6 w-6 text-muted-foreground hover:text-foreground"
                  aria-label="Close"
                  @click="closeGithubStarPopover"
                >
                  <X :size="13" />
                </Button>
                <div class="space-y-3 pr-5">
                  <p class="text-sm font-medium text-foreground">Enjoying BookOrbit?</p>
                  <p class="text-xs leading-relaxed text-muted-foreground">
                    If BookOrbit is helping with your library, please consider starring the project on GitHub. It helps more people discover the app
                    and supports ongoing development.
                  </p>
                  <Button as-child class="w-full">
                    <a :href="githubRepositoryUrl" target="_blank" rel="noopener noreferrer" class="inline-flex items-center justify-center gap-1.5">
                      <span>Star BookOrbit on GitHub</span>
                      <ExternalLink :size="14" />
                    </a>
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
            <TooltipContent>Star on GitHub</TooltipContent>
          </Tooltip>

          <Tooltip>
            <Popover>
              <TooltipTrigger as-child>
                <PopoverTrigger as-child>
                  <Button
                    data-tour="appearance-picker"
                    variant="ghost"
                    size="icon"
                    :class="['h-8 w-8 bg-primary text-primary-foreground hover:bg-primary/90 transition-colors', iconRadiusClass]"
                  >
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
                data-tour="settings-nav"
                variant="ghost"
                size="icon"
                :class="[
                  'h-8 w-8 border border-primary/35 text-foreground/70 hover:border-primary/70 hover:text-foreground transition-colors',
                  iconRadiusClass,
                ]"
                @click="navigateToSettings"
              >
                <Settings :size="15" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Settings</TooltipContent>
          </Tooltip>
        </div>

        <!-- Group 3: Identity (Avatar) -->
        <div class="hidden md:block h-4 w-px bg-foreground/20" />
        <DropdownMenu v-if="user">
          <DropdownMenuTrigger as-child>
            <button
              :class="[
                'flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden border border-primary/50 bg-primary/10 hover:bg-primary/15 hover:border-primary/70 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                iconRadiusClass,
              ]"
            >
              <UserAvatar :name="user.name" :avatar-url="user.avatarUrl ?? null" size-class="h-full w-full" />
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
            <DropdownMenuItem @click="navigateToAccount">
              <User :size="13" class="mr-2 text-muted-foreground" />
              Account
            </DropdownMenuItem>
            <DropdownMenuSeparator v-if="canChangePassword" />
            <DropdownMenuItem v-if="canChangePassword" @click="openChangePassword()">
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
