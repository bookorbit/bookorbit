<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
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
import RadiusPicker from '@/components/RadiusPicker.vue'
import BackgroundPicker from '@/components/BackgroundPicker.vue'
import ThemeToggle from '@/components/ThemeToggle.vue'
import { useGlobalSearch, type GlobalSearchResult } from '@/features/book/composables/useGlobalSearch'
import BookCoverImage from '@/features/book/components/BookCoverImage.vue'
import { useAuth } from '@/features/auth/composables/useAuth'
import { useSettingsDrawer } from '@/composables/useSettingsDrawer'
import { useChangePasswordDialog } from '@/composables/useChangePasswordDialog'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import BookUploadModal from '@/features/library/components/BookUploadModal.vue'

const router = useRouter()
const { user, logout } = useAuth()
const { open: openSettings } = useSettingsDrawer()
const { open: openChangePassword } = useChangePasswordDialog()
const { hasPermission } = usePermissions()

const uploadOpen = ref(false)

const searchFocused = ref(false)
const mobileSearchOpen = ref(false)
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
  <header
    class="flex h-14 shrink-0 items-center gap-2 border-b border-border/50 bg-background/70 backdrop-blur-xl backdrop-saturate-150 px-3 shadow-sm sticky top-0 z-10"
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
              class="text-[10px] font-medium text-primary/70 bg-primary/8 px-1.5 py-0.5 rounded-full border border-primary/15 shrink-0 max-w-20 truncate"
            >
              {{ result.libraryName }}
            </span>
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

      <!-- Right -->
      <div class="ml-auto flex items-center gap-0.5">
        <!-- Mobile: search icon -->
        <Button variant="ghost" size="icon" class="md:hidden h-8 w-8 text-muted-foreground hover:text-foreground" @click="mobileSearchOpen = true">
          <Search :size="15" />
        </Button>

        <!-- Upload button -->
        <Button
          v-if="hasPermission('library_upload')"
          variant="ghost"
          size="icon"
          class="hidden md:flex h-8 w-8 text-muted-foreground hover:text-foreground"
          title="Upload books"
          @click="uploadOpen = true"
        >
          <Upload :size="15" />
        </Button>

        <!-- Desktop: appearance settings popover -->
        <Popover>
          <PopoverTrigger as-child>
            <Button variant="ghost" size="icon" class="hidden md:flex h-8 w-8 text-muted-foreground hover:text-foreground">
              <Palette :size="15" />
            </Button>
          </PopoverTrigger>
          <PopoverContent class="w-72 p-4" align="end">
            <div class="space-y-4">
              <p class="text-xs font-semibold text-foreground uppercase tracking-wider">Appearance</p>
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

        <Button variant="ghost" size="icon" class="hidden md:flex h-8 w-8 text-muted-foreground hover:text-foreground" @click="openSettings()">
          <Settings :size="15" />
        </Button>

        <ThemeToggle />

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
