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
  User,
  BarChart3,
  Trophy,
  MoreVertical,
  BadgeQuestionMark,
  Star,
  ExternalLink,
  Sparkles,
  Check,
  Languages,
} from '@lucide/vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
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
import SurfacePicker from '@/components/SurfacePicker.vue'
import { useGlobalSearch, type GlobalSearchResult } from '@/features/book/composables/useGlobalSearch'
import BookCoverImage from '@/features/book/components/BookCoverImage.vue'
import { useAuth } from '@/features/auth/composables/useAuth'
import { useChangePasswordDialog } from '@/composables/useChangePasswordDialog'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import BookUploadModal from '@/features/library/components/BookUploadModal.vue'
import { useLibraryUploadEvents } from '@/features/library/composables/useLibraryUploadEvents'
import NotificationSheet from '@/features/notifications/components/NotificationSheet.vue'
import { useNotifications } from '@/features/notifications/composables/useNotifications'
import { useWhatsNew } from '@/features/whats-new/composables/useWhatsNew'
import UserAvatar from '@/components/UserAvatar.vue'
import { DEFAULT_FORMAT_PRIORITY, LOCALE_LABELS, SUPPORTED_LOCALES, type Locale } from '@bookorbit/types'
import { useThemeStore } from '@/stores/theme'
import { useLocaleStore } from '@/stores/locale'
import { getFormatColor } from '@/features/book/lib/format-colors'

const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const { user, logout } = useAuth()
const { open: openChangePassword } = useChangePasswordDialog()
const { hasPermission, isDemoRestrictedAccount } = usePermissions()
const { onLibraryUploadCompleted } = useLibraryUploadEvents()
const { subscribe: subscribeNotifications } = useNotifications()
const { hasUnseen: hasUnseenWhatsNew } = useWhatsNew()
const themeStore = useThemeStore()
const localeStore = useLocaleStore()
const languageOptions = SUPPORTED_LOCALES.map((id) => ({ id, label: LOCALE_LABELS[id] }))
const documentationUrl = 'https://bookorbit.app/what-is-bookorbit'
const githubRepositoryUrl = 'https://github.com/bookorbit/bookorbit'
const githubStarPopoverOpen = ref(false)

const iconRadiusClass = computed(() => (themeStore.radius === 'sharp' ? 'rounded-none' : 'rounded-full'))

/**
 * Every header control shares one ghost treatment; nothing in here outranks anything else.
 * Interactive chrome sits at full foreground, matching the sidebar nav rows: muted is for
 * secondary text, not for controls.
 */
const controlClass = computed(() => [
  'h-8 w-8 border border-(--shell-accent-line) text-foreground transition-colors duration-150 hover:bg-(--shell-accent-wash)',
  iconRadiusClass.value,
])

/** Same ghost geometry, plus the tinted active state the two destinations need. */
function destinationClass(isActive: boolean) {
  return [
    'h-8 w-8 border transition-colors duration-150',
    isActive ? 'border-primary bg-(--shell-accent-tint) text-primary' : 'border-(--shell-accent-line) text-foreground hover:bg-(--shell-accent-wash)',
    iconRadiusClass.value,
  ]
}

const isStatisticsActive = computed(() => route.name === 'statistics')
const isAchievementsActive = computed(() => route.name === 'achievements')
const achievementsEnabled = computed(() => user.value?.settings?.achievementPreferences?.enabled !== false)

function navigateToStatistics() {
  router.push({ name: 'statistics', query: { tab: 'library' } })
}

function navigateToAchievements() {
  router.push({ name: 'achievements' })
}

const canChangePassword = computed(
  () => !isDemoRestrictedAccount.value && user.value?.provisioningMethod !== 'oidc' && user.value?.provisioningMethod !== 'shared',
)
const canAccessNotifications = computed(() => hasPermission('notification_access') && !isDemoRestrictedAccount.value)
const GLOBAL_SEARCH_ROW_HEIGHT = 84
const GLOBAL_SEARCH_OVERSCAN = 4
const GLOBAL_SEARCH_VIEWPORT_HEIGHT = 512

function navigateToAccount() {
  router.push({ name: 'settings-account' })
}

function navigateToSettings() {
  router.push({ name: 'settings-libraries' })
}

async function selectLanguage(locale: Locale) {
  try {
    await localeStore.setLocale(locale)
  } catch {
    toast.error(t('settings.appearance.language.loadError'))
  }
}

function navigateToWhatsNew() {
  router.push({ name: 'whats-new' })
}

const uploadOpen = ref(false)

const searchFocused = ref(false)
const mobileSearchOpen = ref(false)
const desktopSearchInput = ref<HTMLInputElement | null>(null)
const mobileSearchInput = ref<HTMLInputElement | null>(null)
const searchDropdownRef = ref<HTMLElement | null>(null)
const searchDropdownScrollTop = ref(0)
const selectedIndex = ref(-1)

const globalSearchQuery = ref('')
const {
  results: globalResults,
  total: globalSearchTotal,
  loading: globalSearchLoading,
  loadingMore: globalSearchLoadingMore,
  settled: globalSearchSettled,
  hasMore: globalSearchHasMore,
  loadMore: loadMoreGlobalSearch,
  clear: clearGlobalSearch,
} = useGlobalSearch(globalSearchQuery)

const showDropdown = computed(
  () =>
    (searchFocused.value || mobileSearchOpen.value) &&
    globalSearchQuery.value.trim().length >= 2 &&
    (globalResults.value.length > 0 || globalSearchLoading.value || globalSearchSettled.value),
)

const globalSearchLoadMoreLabel = computed(() =>
  globalSearchLoadingMore.value
    ? t('components.appHeader.loadingMore')
    : t('components.appHeader.loadMore', { loaded: globalResults.value.length, total: globalSearchTotal.value }),
)
const globalSearchAllLoadedLabel = computed(() => t('components.appHeader.allMatchesShown', { count: globalSearchTotal.value }))
const globalSearchVirtualHeightStyle = computed(() => ({
  height: `${globalResults.value.length * GLOBAL_SEARCH_ROW_HEIGHT}px`,
}))
const globalSearchVirtualRows = computed(() => {
  const start = Math.max(0, Math.floor(searchDropdownScrollTop.value / GLOBAL_SEARCH_ROW_HEIGHT) - GLOBAL_SEARCH_OVERSCAN)
  const visibleCount = Math.ceil(GLOBAL_SEARCH_VIEWPORT_HEIGHT / GLOBAL_SEARCH_ROW_HEIGHT) + GLOBAL_SEARCH_OVERSCAN * 2
  const end = Math.min(globalResults.value.length, start + visibleCount)

  return globalResults.value.slice(start, end).map((result, offset) => {
    const index = start + offset
    return {
      result,
      index,
      style: {
        height: `${GLOBAL_SEARCH_ROW_HEIGHT}px`,
        transform: `translateY(${index * GLOBAL_SEARCH_ROW_HEIGHT}px)`,
      },
    }
  })
})

function onSearchBlur() {
  searchFocused.value = false
  selectedIndex.value = -1
}

watch(globalSearchQuery, () => {
  selectedIndex.value = -1
  searchDropdownScrollTop.value = 0
  void nextTick(() => {
    if (searchDropdownRef.value) searchDropdownRef.value.scrollTop = 0
  })
})

watch(showDropdown, (open) => {
  if (!open) selectedIndex.value = -1
})

watch(mobileSearchOpen, (open) => {
  if (open) nextTick(() => mobileSearchInput.value?.focus())
})

watch(selectedIndex, (index) => {
  if (index < 0) return
  const el = searchDropdownRef.value
  if (!el) return

  const top = index * GLOBAL_SEARCH_ROW_HEIGHT
  const bottom = top + GLOBAL_SEARCH_ROW_HEIGHT
  if (top < el.scrollTop) {
    el.scrollTop = top
  } else if (bottom > el.scrollTop + el.clientHeight) {
    el.scrollTop = bottom - el.clientHeight
  }
  searchDropdownScrollTop.value = el.scrollTop
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
  if (e.key === 'Enter') {
    e.preventDefault()
    const result = selectedIndex.value >= 0 ? globalResults.value[selectedIndex.value] : undefined
    if (result) navigateToResult(result)
    return
  }
  if (!showDropdown.value) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedIndex.value = Math.min(selectedIndex.value + 1, globalResults.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedIndex.value = Math.max(selectedIndex.value - 1, -1)
  }
}

function handleSearchDropdownScroll(event: Event) {
  const el = event.currentTarget as HTMLElement | null
  if (!el) return
  searchDropdownScrollTop.value = el.scrollTop
  if (!globalSearchHasMore.value || globalSearchLoading.value || globalSearchLoadingMore.value) return

  const remaining = el.scrollHeight - el.scrollTop - el.clientHeight
  if (remaining <= 96) void loadMoreGlobalSearch()
}

function handleGlobalKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault()
    desktopSearchInput.value?.focus()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleGlobalKeydown)
  if (canAccessNotifications.value) {
    subscribeNotifications()
  }
})

const stopLibraryUploadListener = onLibraryUploadCompleted((event) => {
  if (event.uploadedCount === 0 && event.failedCount === 0) return

  const uploadedLabel = t('components.appHeader.bookCount', { count: event.uploadedCount })
  const failedLabel = t('components.appHeader.fileCount', { count: event.failedCount })

  if (event.failedCount === 0) {
    toast.success(t('components.appHeader.uploadedToast', { uploaded: uploadedLabel }))
    return
  }
  if (event.uploadedCount === 0) {
    toast.error(t('components.appHeader.uploadFailedToast', { failed: failedLabel }))
    return
  }

  toast.warning(t('components.appHeader.uploadPartialToast', { uploaded: uploadedLabel, failed: failedLabel }))
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

function resultFormats(result: GlobalSearchResult): string[] {
  const formats = new Set<string>()
  for (const file of result.files) {
    const fmt = file.format?.toLowerCase()
    if (fmt) formats.add(fmt)
  }
  return sortFormats([...formats])
}

function formatBadgeStyle(fmt: string) {
  const color = getFormatColor(fmt)
  return {
    color,
    backgroundColor: `color-mix(in oklch, ${color} 10%, transparent)`,
    borderColor: `color-mix(in oklch, ${color} 20%, transparent)`,
  }
}
</script>

<template>
  <header
    class="relative z-30 mx-(--shell-gap) mt-(--shell-gap) flex h-12 flex-none shrink-0 items-center gap-2 rounded-(--shell-radius) border border-(--shell-border) bg-(--shell-surface) px-3 shadow-lg backdrop-blur-xl backdrop-saturate-150"
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
          :placeholder="t('components.appHeader.searchAllBooks')"
          class="w-full h-8 pl-8 pr-7 text-[14px] rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary transition-shadow"
        />
        <button v-if="globalSearchQuery" @click="clearSearch()" class="absolute right-2 text-muted-foreground hover:text-foreground">
          <X :size="13" />
        </button>

        <!-- Mobile search dropdown -->
        <Transition name="search-drop">
          <div
            v-if="showDropdown"
            ref="searchDropdownRef"
            data-testid="global-search-dropdown"
            @mousedown.prevent
            @scroll.passive="handleSearchDropdownScroll"
            class="absolute top-full left-0 right-0 mt-1 max-h-[min(32rem,calc(100dvh-5rem))] overflow-y-auto overflow-x-hidden rounded-md border border-border bg-background shadow-lg z-50"
          >
            <div v-if="globalSearchLoading && globalResults.length === 0" class="p-3 text-[13px] text-muted-foreground text-center">
              {{ t('components.appHeader.searching') }}
            </div>
            <div
              v-else-if="globalSearchSettled && !globalSearchLoading && globalResults.length === 0"
              class="p-3 text-[13px] text-muted-foreground text-center"
            >
              {{ t('components.appHeader.noResults') }}
            </div>
            <div v-if="globalResults.length > 0" class="relative" :style="globalSearchVirtualHeightStyle">
              <button
                v-for="row in globalSearchVirtualRows"
                :key="row.result.id"
                :style="row.style"
                @click="navigateToResult(row.result)"
                :class="[
                  'absolute left-0 right-0 flex items-center gap-3 border-b border-border px-3 py-2.5 text-left transition-colors',
                  selectedIndex === row.index ? 'bg-accent' : 'hover:bg-accent/60',
                ]"
              >
                <BookCoverImage
                  :book-id="row.result.id"
                  type="thumbnail"
                  :version="row.result.updatedAt"
                  class="h-16 w-12 object-cover rounded shrink-0 bg-muted"
                  :alt="row.result.title ?? ''"
                />
                <div class="flex-1 min-w-0">
                  <p class="text-[14px] font-medium text-foreground truncate">
                    <template v-for="seg in highlightSegments(row.result.title, globalSearchQuery)" :key="seg.text + seg.match">
                      <span v-if="seg.match" class="bg-(--shell-accent-tint) text-foreground font-semibold rounded-sm px-0.5">{{ seg.text }}</span>
                      <span v-else>{{ seg.text }}</span>
                    </template>
                  </p>
                  <p v-if="row.result.authors.length" class="text-[13px] text-muted-foreground truncate mt-0.5">
                    <template v-for="seg in highlightSegments(row.result.authors.join(', '), globalSearchQuery)" :key="seg.text + seg.match">
                      <span v-if="seg.match" class="bg-(--shell-accent-tint) text-foreground font-semibold rounded-sm px-0.5">{{ seg.text }}</span>
                      <span v-else>{{ seg.text }}</span>
                    </template>
                  </p>
                  <p v-if="row.result.seriesName" class="text-[13px] text-muted-foreground truncate mt-0.5 italic">
                    <template v-for="seg in highlightSegments(row.result.seriesName, globalSearchQuery)" :key="seg.text + seg.match">
                      <span v-if="seg.match" class="bg-(--shell-accent-tint) text-foreground font-semibold rounded-sm px-0.5 not-italic">{{
                        seg.text
                      }}</span>
                      <span v-else>{{ seg.text }}</span>
                    </template>
                  </p>
                </div>
                <div v-if="resultFormats(row.result).length" class="flex shrink-0 gap-1">
                  <span
                    v-for="fmt in resultFormats(row.result)"
                    :key="fmt"
                    :class="['text-[11px] font-semibold px-1 py-0.5 rounded border uppercase']"
                    :style="formatBadgeStyle(fmt)"
                  >
                    {{ fmt }}
                  </span>
                </div>
              </button>
            </div>
            <div v-if="globalResults.length > 0" class="border-t border-border px-3 py-2 text-center text-[13px] text-muted-foreground">
              <button
                v-if="globalSearchHasMore"
                type="button"
                class="font-medium text-primary transition-colors duration-150 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                :disabled="globalSearchLoadingMore"
                @click="loadMoreGlobalSearch"
              >
                {{ globalSearchLoadMoreLabel }}
              </button>
              <span v-else>{{ globalSearchAllLoadedLabel }}</span>
            </div>
          </div>
        </Transition>
      </div>
    </template>

    <!-- Normal state -->
    <template v-else>
      <!-- Left: sidebar trigger -->
      <SidebarTrigger :class="['-ml-1 text-foreground hover:bg-(--shell-accent-wash)', iconRadiusClass]" />
      <Separator orientation="vertical" class="mx-1 h-4" />

      <!-- Center: desktop global search -->
      <div data-tour="global-search" class="relative mx-4 hidden w-full max-w-2xl items-center md:flex">
        <Search class="pointer-events-none absolute left-3 text-muted-foreground" :size="14" />
        <input
          ref="desktopSearchInput"
          v-model="globalSearchQuery"
          @focus="searchFocused = true"
          @blur="onSearchBlur"
          @keydown="handleSearchKeydown"
          :placeholder="t('components.appHeader.searchAllBooks')"
          :class="[
            'h-8 w-full border border-(--shell-accent-line) bg-(--shell-accent-wash) pl-9 pr-8 text-[14px] text-foreground transition-colors duration-150',
            'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring',
            iconRadiusClass,
          ]"
        />
        <div class="absolute inset-y-0 right-2.5 flex items-center gap-1.5">
          <button
            v-if="globalSearchQuery"
            @click="clearSearch()"
            class="flex items-center justify-center text-muted-foreground transition-colors duration-150 hover:text-foreground"
          >
            <X :size="13" />
          </button>
          <kbd
            v-else
            class="hidden h-5 select-none items-center gap-1 rounded border border-(--shell-accent-line) px-1.5 font-mono text-[11px] font-semibold text-muted-foreground lg:inline-flex"
          >
            <span class="leading-none">⌘</span>
            <span class="leading-none">K</span>
          </kbd>
        </div>

        <!-- Desktop search dropdown -->
        <Transition name="search-drop">
          <div
            v-if="showDropdown"
            ref="searchDropdownRef"
            data-testid="global-search-dropdown"
            @mousedown.prevent
            @scroll.passive="handleSearchDropdownScroll"
            class="absolute top-full left-0 right-0 mt-1 max-h-[min(32rem,calc(100dvh-5rem))] overflow-y-auto overflow-x-hidden rounded-md border border-border bg-background shadow-lg z-50"
          >
            <div v-if="globalSearchLoading && globalResults.length === 0" class="p-3 text-[13px] text-muted-foreground text-center">
              {{ t('components.appHeader.searching') }}
            </div>
            <div
              v-else-if="globalSearchSettled && !globalSearchLoading && globalResults.length === 0"
              class="p-3 text-[13px] text-muted-foreground text-center"
            >
              {{ t('components.appHeader.noResults') }}
            </div>
            <div v-if="globalResults.length > 0" class="relative" :style="globalSearchVirtualHeightStyle">
              <button
                v-for="row in globalSearchVirtualRows"
                :key="row.result.id"
                :style="row.style"
                @click="navigateToResult(row.result)"
                :class="[
                  'absolute left-0 right-0 flex items-center gap-3 border-b border-border px-3 py-2.5 text-left transition-colors',
                  selectedIndex === row.index ? 'bg-accent' : 'hover:bg-accent/60',
                ]"
              >
                <BookCoverImage
                  :book-id="row.result.id"
                  type="thumbnail"
                  :version="row.result.updatedAt"
                  class="h-16 w-12 object-cover rounded shrink-0 bg-muted"
                  :alt="row.result.title ?? ''"
                />
                <div class="flex-1 min-w-0">
                  <p class="text-[14px] font-medium text-foreground truncate">
                    <template v-for="seg in highlightSegments(row.result.title, globalSearchQuery)" :key="seg.text + seg.match">
                      <span v-if="seg.match" class="bg-(--shell-accent-tint) text-foreground font-semibold rounded-sm px-0.5">{{ seg.text }}</span>
                      <span v-else>{{ seg.text }}</span>
                    </template>
                  </p>
                  <p v-if="row.result.authors.length" class="text-[13px] text-muted-foreground truncate mt-0.5">
                    <template v-for="seg in highlightSegments(row.result.authors.join(', '), globalSearchQuery)" :key="seg.text + seg.match">
                      <span v-if="seg.match" class="bg-(--shell-accent-tint) text-foreground font-semibold rounded-sm px-0.5">{{ seg.text }}</span>
                      <span v-else>{{ seg.text }}</span>
                    </template>
                  </p>
                  <p v-if="row.result.seriesName" class="text-[13px] text-muted-foreground truncate mt-0.5 italic">
                    <template v-for="seg in highlightSegments(row.result.seriesName, globalSearchQuery)" :key="seg.text + seg.match">
                      <span v-if="seg.match" class="bg-(--shell-accent-tint) text-foreground font-semibold rounded-sm px-0.5 not-italic">{{
                        seg.text
                      }}</span>
                      <span v-else>{{ seg.text }}</span>
                    </template>
                  </p>
                </div>
                <div v-if="resultFormats(row.result).length" class="flex shrink-0 gap-1">
                  <span
                    v-for="fmt in resultFormats(row.result)"
                    :key="fmt"
                    :class="['text-[11px] font-semibold px-1 py-0.5 rounded border uppercase']"
                    :style="formatBadgeStyle(fmt)"
                  >
                    {{ fmt }}
                  </span>
                </div>
              </button>
            </div>
            <div v-if="globalResults.length > 0" class="border-t border-border px-3 py-2 text-center text-[13px] text-muted-foreground">
              <button
                v-if="globalSearchHasMore"
                type="button"
                class="font-medium text-primary transition-colors duration-150 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                :disabled="globalSearchLoadingMore"
                @click="loadMoreGlobalSearch"
              >
                {{ globalSearchLoadMoreLabel }}
              </button>
              <span v-else>{{ globalSearchAllLoadedLabel }}</span>
            </div>
          </div>
        </Transition>
      </div>

      <!-- Right -->
      <div class="ml-auto flex items-center gap-3">
        <!-- Mobile: search icon -->
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon" :class="['md:hidden', controlClass]" @click="mobileSearchOpen = true">
              <Search :size="15" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{ t('common.search') }}</TooltipContent>
        </Tooltip>

        <!-- Mobile: Notifications bell -->
        <div class="md:hidden">
          <NotificationSheet v-if="canAccessNotifications" :icon-radius-class="iconRadiusClass" />
        </div>

        <!-- Mobile: Kebab Menu -->
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="icon" :class="['md:hidden', controlClass]">
              <MoreVertical :size="15" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-44">
            <DropdownMenuItem @click="navigateToStatistics">
              <BarChart3 :size="15" class="mr-2 text-muted-foreground" />
              {{ t('components.appHeader.statistics') }}
            </DropdownMenuItem>
            <DropdownMenuItem v-if="achievementsEnabled" @click="navigateToAchievements">
              <Trophy :size="15" class="mr-2 text-muted-foreground" />
              {{ t('components.appHeader.achievements') }}
            </DropdownMenuItem>
            <DropdownMenuItem v-if="hasPermission('library_upload')" @click="uploadOpen = true">
              <Upload :size="15" class="mr-2 text-muted-foreground" />
              {{ t('components.appHeader.uploadBooks') }}
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Palette :size="15" class="mr-2 text-muted-foreground" />
                {{ t('components.appHeader.appearance') }}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent class="w-72 p-4">
                <div class="space-y-4">
                  <div class="space-y-1.5">
                    <span class="text-[13px] text-muted-foreground">{{ t('components.appHeader.theme') }}</span>
                    <ThemePicker />
                  </div>
                  <div class="space-y-1.5">
                    <span class="text-[13px] text-muted-foreground">{{ t('components.appHeader.accent') }}</span>
                    <AccentPicker />
                  </div>
                  <div class="space-y-1.5">
                    <span class="text-[13px] text-muted-foreground">{{ t('components.appHeader.radius') }}</span>
                    <RadiusPicker />
                  </div>
                  <div class="space-y-1.5">
                    <span class="text-[13px] text-muted-foreground">{{ t('components.appHeader.surfaceOpacity') }}</span>
                    <SurfacePicker />
                  </div>
                  <div class="space-y-1.5">
                    <span class="text-[13px] text-muted-foreground">{{ t('components.appHeader.background') }}</span>
                    <BackgroundPicker />
                  </div>
                </div>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Languages :size="15" class="mr-2 text-muted-foreground" />
                {{ t('settings.appearance.language.label') }}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent class="w-44">
                <DropdownMenuItem v-for="option in languageOptions" :key="option.id" @click="selectLanguage(option.id)">
                  <Check v-if="localeStore.locale === option.id" :size="14" class="mr-2" />
                  <span v-else class="mr-2 w-3.5" />
                  {{ option.label }}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuItem @click="navigateToSettings">
              <Settings :size="15" class="mr-2 text-muted-foreground" />
              {{ t('components.appHeader.settings') }}
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem @click="navigateToWhatsNew">
              <Sparkles :size="15" class="mr-2 text-muted-foreground" />
              {{ t('components.appHeader.whatsNew') }}
              <span v-if="hasUnseenWhatsNew" class="ml-auto h-1.5 w-1.5 rounded-full bg-primary" :aria-label="t('components.appHeader.new')" />
            </DropdownMenuItem>
            <DropdownMenuItem as-child>
              <a :href="documentationUrl" target="_blank" rel="noopener noreferrer">
                <BadgeQuestionMark :size="15" class="mr-2 text-muted-foreground" />
                {{ t('components.appHeader.documentation') }}
                <ExternalLink :size="12" class="ml-auto text-muted-foreground" />
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <!-- Group 1: Content (Notifications, Statistics, Achievements, Upload) -->
        <div class="hidden md:flex items-center gap-2.5">
          <NotificationSheet v-if="canAccessNotifications" :icon-radius-class="iconRadiusClass" />

          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                data-tour="statistics-btn"
                variant="ghost"
                size="icon"
                :class="destinationClass(isStatisticsActive)"
                @click="navigateToStatistics"
              >
                <BarChart3 :size="15" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{{ t('components.appHeader.statistics') }}</TooltipContent>
          </Tooltip>

          <Tooltip v-if="achievementsEnabled">
            <TooltipTrigger as-child>
              <Button variant="ghost" size="icon" :class="destinationClass(isAchievementsActive)" @click="navigateToAchievements">
                <Trophy :size="15" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{{ t('components.appHeader.achievements') }}</TooltipContent>
          </Tooltip>

          <Tooltip v-if="hasPermission('library_upload')">
            <TooltipTrigger as-child>
              <Button data-tour="upload-button" variant="ghost" size="icon" :class="controlClass" @click="uploadOpen = true">
                <Upload :size="15" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{{ t('components.appHeader.uploadBooks') }}</TooltipContent>
          </Tooltip>
        </div>

        <!-- Group 2: Preferences (Help, GitHub, Appearance, Language, Settings) -->
        <Separator orientation="vertical" class="mx-1 hidden h-4 md:block" />
        <div class="hidden md:flex items-center gap-2.5">
          <Tooltip>
            <DropdownMenu>
              <TooltipTrigger as-child>
                <DropdownMenuTrigger as-child>
                  <Button data-tour="documentation-link" variant="ghost" size="icon" :class="['relative', controlClass]">
                    <BadgeQuestionMark :size="15" />
                    <span
                      v-if="hasUnseenWhatsNew"
                      class="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary ring-2 ring-background"
                      :aria-label="t('components.appHeader.newReleaseNotes')"
                    />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <DropdownMenuContent align="end" class="w-48">
                <DropdownMenuItem as-child>
                  <a :href="documentationUrl" target="_blank" rel="noopener noreferrer">
                    <BadgeQuestionMark :size="14" class="mr-2 text-muted-foreground" />
                    {{ t('components.appHeader.documentation') }}
                    <ExternalLink :size="12" class="ml-auto text-muted-foreground" />
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem @click="navigateToWhatsNew">
                  <Sparkles :size="14" class="mr-2 text-muted-foreground" />
                  {{ t('components.appHeader.whatsNew') }}
                  <span v-if="hasUnseenWhatsNew" class="ml-auto h-1.5 w-1.5 rounded-full bg-primary" :aria-label="t('components.appHeader.new')" />
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <TooltipContent>{{ t('components.appHeader.help') }}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <Popover :open="githubStarPopoverOpen" @update:open="handleGithubStarPopoverOpenChange">
              <TooltipTrigger as-child>
                <PopoverTrigger as-child>
                  <Button data-tour="github-star-cta" variant="ghost" size="icon" :class="controlClass">
                    <Star :size="15" />
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <PopoverContent side="bottom" align="end" class="relative w-80 p-4">
                <Button
                  variant="ghost"
                  size="icon"
                  class="absolute right-2 top-2 h-6 w-6 text-muted-foreground hover:text-foreground"
                  :aria-label="t('common.close')"
                  @click="closeGithubStarPopover"
                >
                  <X :size="13" />
                </Button>
                <div class="space-y-3 pr-5">
                  <p class="text-[14px] font-medium text-foreground">{{ t('components.appHeader.githubStar.title') }}</p>
                  <p class="text-[13px] leading-relaxed text-muted-foreground">
                    {{ t('components.appHeader.githubStar.body') }}
                  </p>
                  <Button as-child class="w-full">
                    <a :href="githubRepositoryUrl" target="_blank" rel="noopener noreferrer" class="inline-flex items-center justify-center gap-1.5">
                      <span>{{ t('components.appHeader.githubStar.cta') }}</span>
                      <ExternalLink :size="14" />
                    </a>
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
            <TooltipContent>{{ t('components.appHeader.starOnGithub') }}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <Popover>
              <TooltipTrigger as-child>
                <PopoverTrigger as-child>
                  <Button data-tour="appearance-picker" variant="ghost" size="icon" :class="controlClass">
                    <Palette :size="15" />
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <PopoverContent class="w-72 p-4" align="end">
                <div class="space-y-4">
                  <p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground">{{ t('components.appHeader.appearance') }}</p>
                  <div class="space-y-1.5">
                    <span class="text-[13px] text-muted-foreground">{{ t('components.appHeader.theme') }}</span>
                    <ThemePicker />
                  </div>
                  <div class="space-y-1.5">
                    <span class="text-[13px] text-muted-foreground">{{ t('components.appHeader.accent') }}</span>
                    <AccentPicker />
                  </div>
                  <div class="space-y-1.5">
                    <span class="text-[13px] text-muted-foreground">{{ t('components.appHeader.radius') }}</span>
                    <RadiusPicker />
                  </div>
                  <div class="space-y-1.5">
                    <span class="text-[13px] text-muted-foreground">{{ t('components.appHeader.surfaceOpacity') }}</span>
                    <SurfacePicker />
                  </div>
                  <div class="space-y-1.5">
                    <span class="text-[13px] text-muted-foreground">{{ t('components.appHeader.background') }}</span>
                    <BackgroundPicker />
                  </div>
                </div>
              </PopoverContent>
            </Popover>
            <TooltipContent>{{ t('components.appHeader.appearance') }}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <DropdownMenu>
              <TooltipTrigger as-child>
                <DropdownMenuTrigger as-child>
                  <Button
                    data-testid="language-control"
                    variant="ghost"
                    size="icon"
                    :class="controlClass"
                    :aria-label="t('settings.appearance.language.label')"
                  >
                    <Languages :size="15" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <DropdownMenuContent align="end" class="w-44">
                <DropdownMenuLabel>{{ t('settings.appearance.language.label') }}</DropdownMenuLabel>
                <DropdownMenuItem v-for="option in languageOptions" :key="option.id" @click="selectLanguage(option.id)">
                  <Check v-if="localeStore.locale === option.id" :size="14" class="mr-2" />
                  <span v-else class="mr-2 w-3.5" />
                  {{ option.label }}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <TooltipContent>{{ t('settings.appearance.language.label') }}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger as-child>
              <Button data-tour="settings-nav" variant="ghost" size="icon" :class="controlClass" @click="navigateToSettings">
                <Settings :size="15" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{{ t('components.appHeader.settings') }}</TooltipContent>
          </Tooltip>
        </div>

        <!-- Group 3: Identity (Avatar) -->
        <Separator orientation="vertical" class="mx-1 hidden h-4 md:block" />
        <DropdownMenu v-if="user">
          <DropdownMenuTrigger as-child>
            <button
              :class="[
                'flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden border border-(--shell-accent-line) bg-(--shell-accent-tint) transition-colors duration-150 hover:bg-(--shell-accent-wash) focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                iconRadiusClass,
              ]"
            >
              <UserAvatar :name="user.name" :avatar-url="user.avatarUrl ?? null" size-class="h-full w-full" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-48">
            <DropdownMenuLabel class="font-normal">
              <div class="flex flex-col gap-0.5">
                <span class="text-[13px] font-medium text-foreground">{{ user.name }}</span>
                <span class="text-[11px] text-muted-foreground">{{ user.username }}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem @click="navigateToAccount">
              <User :size="13" class="mr-2 text-muted-foreground" />
              {{ t('components.appHeader.account') }}
            </DropdownMenuItem>
            <DropdownMenuSeparator v-if="canChangePassword" />
            <DropdownMenuItem v-if="canChangePassword" @click="openChangePassword()">
              <KeyRound :size="13" class="mr-2 text-muted-foreground" />
              {{ t('components.appHeader.changePassword') }}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem @click="logout" class="text-destructive focus:text-destructive">
              <LogOut :size="13" class="mr-2" />
              {{ t('components.appHeader.signOut') }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </template>
  </header>

  <BookUploadModal v-if="uploadOpen" @close="uploadOpen = false" @uploaded="uploadOpen = false" />
</template>
