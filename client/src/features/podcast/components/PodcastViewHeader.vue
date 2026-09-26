<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Activity, AlertCircle, ArrowUpDown, Plus, RefreshCw, Search, Settings, SlidersHorizontal, X } from '@lucide/vue'
import { formatNumber } from '@/i18n/formatters'
import AppIcon from '@/components/AppIcon.vue'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import ViewHeaderDesktopSearch from '@/components/view-header/ViewHeaderDesktopSearch.vue'
import ViewHeaderDisplayControls from '@/components/view-header/ViewHeaderDisplayControls.vue'
import ViewHeaderMobileSearchSheet from '@/components/view-header/ViewHeaderMobileSearchSheet.vue'

defineProps<{
  title: string
  icon?: string
  total: number
  views: Array<{ id: string; label: string }>
  currentView: string
  viewsLabel: string
  searchQuery: string
  searchPlaceholder: string
  refreshing?: boolean
  sortable?: boolean
  sortLabel: string
  sortOptions: Array<{ id: string; label: string; active: boolean }>
  activeSortId?: string
  activeSortLabel: string
  isDefaultSort?: boolean
  canManageFeeds?: boolean
  canOpenSettings?: boolean
  hasUnhealthyFeeds?: boolean
  healthActive?: boolean
  showDisplayControls?: boolean
  coverSize: number
  gridGap: number
  showContext?: boolean
}>()

const emit = defineEmits<{
  'update:searchQuery': [value: string]
  'update:sort': [value: string]
  'update:coverSize': [value: number]
  'update:gridGap': [value: number]
  'select-view': [value: string]
  'reset-sort': []
  'select-health': []
  'add-feed': []
  'open-settings': []
}>()

const { t } = useI18n()

const mobileSearchOpen = ref(false)
const mobileDisplayOpen = ref(false)

function handleSortUpdate(value: unknown) {
  if (typeof value === 'string') emit('update:sort', value)
}

function handleResetSort() {
  emit('reset-sort')
}

function handleSelectHealth() {
  emit('select-health')
}

function handleAddFeed() {
  emit('add-feed')
}

function handleOpenSettings() {
  emit('open-settings')
}

function handleSearchQueryUpdate(value: string) {
  emit('update:searchQuery', value)
}

function handleCoverSizeUpdate(value: number) {
  emit('update:coverSize', value)
}

function handleGridGapUpdate(value: number) {
  emit('update:gridGap', value)
}

function openMobileSearch() {
  mobileSearchOpen.value = true
}

function setMobileSearchOpen(open: boolean) {
  mobileSearchOpen.value = open
}

function openMobileDisplay() {
  mobileDisplayOpen.value = true
}

function selectView(view: string) {
  emit('select-view', view)
}
</script>

<template>
  <div class="sticky top-0 z-20 mb-2 mt-2 shrink-0 border-b border-border/60 bg-background/80 backdrop-blur-md">
    <div class="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-2 px-2 py-2">
      <div class="flex min-w-0 flex-1 items-center gap-2.5">
        <AppIcon v-if="icon" :icon="icon" fallback="Radio" :size="26" class="shrink-0 text-primary" />
        <h1 class="min-w-0 truncate font-serif text-2xl font-semibold leading-tight tracking-tight text-foreground">{{ title }}</h1>
        <RefreshCw v-if="refreshing" class="size-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden="true" />
        <span v-if="refreshing" class="sr-only" role="status">{{ t('podcast.library.loading') }}</span>
      </div>

      <div class="flex shrink-0 items-center gap-1.5">
        <ViewHeaderDesktopSearch :search-query="searchQuery" :placeholder="searchPlaceholder" @update:search-query="handleSearchQueryUpdate" />
        <Button
          variant="ghost"
          size="icon-sm"
          class="text-foreground hover:bg-primary/5 md:hidden"
          :aria-label="t('common.search')"
          @click="openMobileSearch"
        >
          <Search :size="16" />
        </Button>

        <Button v-if="canManageFeeds" size="sm" class="gap-1.5" :aria-label="t('podcast.library.addFeed')" @click="handleAddFeed">
          <Plus :size="14" /> <span class="hidden sm:inline">{{ t('podcast.library.addFeed') }}</span>
        </Button>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 px-2">
      <nav class="no-scrollbar -mb-px min-w-0 flex-1 overflow-x-auto" :aria-label="viewsLabel">
        <div class="flex w-max items-center gap-1">
          <button
            v-for="view in views"
            :key="view.id"
            type="button"
            class="flex h-10 shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            :class="currentView === view.id ? 'border-primary text-primary' : 'border-transparent text-foreground hover:border-border'"
            :aria-current="currentView === view.id ? 'page' : undefined"
            @click="selectView(view.id)"
          >
            {{ view.label }}
            <span v-if="currentView === view.id" class="tabular-nums text-xs font-normal text-muted-foreground">{{ formatNumber(total) }}</span>
          </button>
        </div>
      </nav>

      <div class="flex shrink-0 items-center gap-1">
        <template v-if="sortable">
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button
                variant="outline"
                size="sm"
                class="gap-1.5"
                :class="isDefaultSort ? 'text-foreground' : 'border-primary bg-primary/10 text-primary'"
                :aria-label="sortLabel"
              >
                <ArrowUpDown :size="14" />
                <span class="hidden lg:inline">{{ activeSortLabel }}</span>
                <span class="hidden sm:inline lg:hidden">{{ t('podcast.sort.label') }}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-56">
              <p id="podcast-sort-heading" class="px-2 py-1.5 text-xs font-medium text-muted-foreground">{{ sortLabel }}</p>
              <DropdownMenuRadioGroup :model-value="activeSortId" aria-labelledby="podcast-sort-heading" @update:model-value="handleSortUpdate">
                <DropdownMenuRadioItem v-for="option in sortOptions" :key="option.id" :value="option.id">
                  {{ option.label }}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            v-if="!isDefaultSort"
            variant="ghost"
            size="icon-sm"
            class="text-foreground hover:bg-primary/5"
            :aria-label="t('common.resetSortAria')"
            @click="handleResetSort"
          >
            <X :size="14" />
          </Button>
        </template>

        <Popover v-if="showDisplayControls">
          <PopoverTrigger as-child>
            <Button
              variant="ghost"
              size="icon-sm"
              class="hidden text-foreground hover:bg-primary/5 md:flex"
              :aria-label="t('components.viewHeader.display')"
              :title="t('components.viewHeader.display')"
            >
              <SlidersHorizontal :size="15" />
            </Button>
          </PopoverTrigger>
          <PopoverContent class="w-56 p-4" align="end">
            <ViewHeaderDisplayControls
              view-mode="grid"
              :cover-size="coverSize"
              :grid-gap="gridGap"
              @update:cover-size="handleCoverSizeUpdate"
              @update:grid-gap="handleGridGapUpdate"
            />
          </PopoverContent>
        </Popover>
        <Button
          v-if="showDisplayControls"
          variant="ghost"
          size="icon-sm"
          class="text-foreground hover:bg-primary/5 md:hidden"
          :aria-label="t('components.viewHeader.display')"
          @click="openMobileDisplay"
        >
          <SlidersHorizontal :size="15" />
        </Button>

        <Button
          v-if="canManageFeeds"
          variant="ghost"
          size="sm"
          class="h-8 gap-1.5 text-xs"
          :class="
            hasUnhealthyFeeds
              ? 'text-destructive hover:bg-destructive/10 hover:text-destructive'
              : 'text-foreground hover:bg-primary/5 hover:text-foreground'
          "
          :aria-current="healthActive ? 'page' : undefined"
          data-testid="podcast-feed-health"
          @click="handleSelectHealth"
        >
          <AlertCircle v-if="hasUnhealthyFeeds" :size="14" data-testid="podcast-feed-health-badge" />
          <Activity v-else :size="14" />
          <span class="hidden sm:inline">
            {{ hasUnhealthyFeeds ? t('podcast.library.feedsNeedAttention') : t('podcast.library.feedHealth') }}
          </span>
        </Button>
        <Button
          v-if="canOpenSettings"
          variant="ghost"
          size="sm"
          class="h-8 gap-1.5 text-xs text-foreground hover:bg-primary/5 hover:text-foreground"
          :aria-label="t('podcast.library.settings')"
          @click="handleOpenSettings"
        >
          <Settings :size="14" />
          <span class="hidden sm:inline">{{ t('podcast.library.settings') }}</span>
        </Button>
      </div>
    </div>

    <div v-if="showContext" class="border-t border-border/60 px-2 py-2">
      <slot name="context" />
    </div>
  </div>

  <ViewHeaderMobileSearchSheet
    :open="mobileSearchOpen"
    :search-query="searchQuery"
    :placeholder="searchPlaceholder"
    @update:open="setMobileSearchOpen"
    @update:search-query="handleSearchQueryUpdate"
  />

  <Sheet v-if="showDisplayControls" v-model:open="mobileDisplayOpen">
    <SheetContent side="bottom">
      <SheetHeader>
        <SheetTitle>{{ t('components.viewHeader.display') }}</SheetTitle>
        <SheetDescription class="sr-only">{{ t('components.viewHeader.displayDescription') }}</SheetDescription>
      </SheetHeader>
      <div class="px-4 pb-6">
        <ViewHeaderDisplayControls
          view-mode="grid"
          :cover-size="coverSize"
          :grid-gap="gridGap"
          @update:cover-size="handleCoverSizeUpdate"
          @update:grid-gap="handleGridGapUpdate"
        />
      </div>
    </SheetContent>
  </Sheet>
</template>
