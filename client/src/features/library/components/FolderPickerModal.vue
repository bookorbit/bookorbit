<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, ChevronRight, ChevronUp, Folder, FolderOpen, FolderPlus, HardDrive, Info, Loader2, Search, X } from '@lucide/vue'
import { RecycleScroller } from 'vue-virtual-scroller'
import { useModal } from '@/composables/useModal'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useFolderBrowser } from '../composables/useFolderBrowser'

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    selectedPaths?: string[]
  }>(),
  {
    selectedPaths: () => [],
  },
)

const emit = defineEmits<{
  select: [paths: string[]]
  close: []
}>()

const panel = ref<HTMLElement | null>(null)
const {
  currentPath,
  loading,
  search,
  error,
  selectedPaths,
  selectionNotice,
  creatingFolder,
  newFolderName,
  createError,
  createLoading,
  newFolderInput,
  filteredEntries,
  breadcrumbs,
  canGoUp,
  selectedCount,
  navigate,
  goUp,
  reloadCurrent,
  clearSearch,
  isSelected,
  existingPathStatus,
  selectedPathStatus,
  isSelectionDisabled,
  toggleSelection,
  toggleCurrentPath,
  toggleNewFolder,
  cancelNewFolder,
  submitNewFolder,
  onNewFolderKeydown,
} = useFolderBrowser(() => props.selectedPaths)

const addButtonLabel = computed(() => {
  if (selectedCount.value === 0) return 'Add folders'
  return `Add ${selectedCount.value} folder${selectedCount.value === 1 ? '' : 's'}`
})

function requestClose() {
  if (createLoading.value) return
  emit('close')
}

function addSelectedFolders() {
  if (selectedPaths.value.length === 0) return
  emit('select', selectedPaths.value)
}

useModal({
  container: panel,
  onClose: requestClose,
  disabled: () => createLoading.value,
})
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-[80] flex items-end justify-center bg-foreground/30 sm:items-center sm:p-4"
      role="presentation"
      @click.self="requestClose"
    >
      <div
        ref="panel"
        class="flex h-dvh w-full flex-col overflow-hidden bg-background shadow-2xl outline-none sm:h-[min(82dvh,700px)] sm:max-w-xl sm:rounded-lg sm:border sm:border-border"
        role="dialog"
        aria-modal="true"
        aria-labelledby="folder-picker-title"
        aria-describedby="folder-picker-description"
        tabindex="-1"
      >
        <header class="flex shrink-0 items-start justify-between gap-3 border-b border-border bg-card px-4 py-3">
          <div class="flex min-w-0 items-start gap-2.5">
            <HardDrive :size="18" class="mt-0.5 shrink-0 text-primary" />
            <div class="min-w-0">
              <h2 id="folder-picker-title" class="text-base font-semibold text-foreground">{{ t('library.folderPicker.title') }}</h2>
              <p id="folder-picker-description" class="text-xs text-muted-foreground">{{ t('library.folderPicker.description') }}</p>
            </div>
          </div>
          <button
            type="button"
            class="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            :aria-label="t('library.folderPicker.closeAria')"
            @click="requestClose"
          >
            <X :size="18" />
          </button>
        </header>

        <nav
          class="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-muted/25 px-3"
          :aria-label="t('library.folderPicker.currentFolderAria')"
        >
          <Tooltip>
            <TooltipTrigger as-child>
              <button
                type="button"
                class="mr-1 flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
                :disabled="!canGoUp"
                :aria-label="t('library.folderPicker.parentFolder')"
                @click="goUp"
              >
                <ChevronUp :size="14" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{{ t('library.folderPicker.parentFolder') }}</TooltipContent>
          </Tooltip>
          <template v-for="(crumb, index) in breadcrumbs" :key="crumb.path">
            <ChevronRight v-if="index > 0" :size="12" class="shrink-0 text-muted-foreground/60" />
            <button
              type="button"
              class="shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-xs transition-colors"
              :class="
                index === breadcrumbs.length - 1
                  ? 'bg-background font-medium text-foreground shadow-xs'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              "
              @click="navigate(crumb.path)"
            >
              {{ crumb.label }}
            </button>
          </template>
        </nav>

        <div class="grid shrink-0 gap-2 border-b border-border p-2 sm:grid-cols-[1fr_auto] sm:px-3">
          <label class="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-2.5 focus-within:ring-1 focus-within:ring-ring">
            <Search :size="15" class="shrink-0 text-muted-foreground" />
            <input
              v-model="search"
              type="text"
              :placeholder="t('library.folderPicker.filterPlaceholder')"
              class="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
            />
            <button
              v-if="search"
              type="button"
              class="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              :aria-label="t('library.folderPicker.clearFilterAria')"
              @click="clearSearch"
            >
              <X :size="14" />
            </button>
          </label>
          <button
            type="button"
            class="flex h-9 items-center justify-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            @click="toggleNewFolder"
          >
            <FolderPlus :size="15" />
            {{ t('library.folderPicker.newFolder') }}
          </button>
        </div>

        <div v-if="creatingFolder" class="shrink-0 border-b border-border bg-muted/20 p-2 sm:px-3">
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label
              class="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-background px-2.5 focus-within:ring-1 focus-within:ring-ring"
            >
              <FolderPlus :size="15" class="shrink-0 text-primary" />
              <input
                ref="newFolderInput"
                v-model="newFolderName"
                type="text"
                :placeholder="t('library.folderPicker.newFolderNamePlaceholder')"
                class="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
                @keydown="onNewFolderKeydown"
              />
            </label>
            <div class="grid grid-cols-2 gap-2 sm:flex">
              <button
                type="button"
                class="flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                :disabled="!newFolderName.trim() || createLoading"
                @click="submitNewFolder"
              >
                <Loader2 v-if="createLoading" :size="15" class="animate-spin" />
                {{ t('library.folderPicker.create') }}
              </button>
              <button
                type="button"
                class="h-9 rounded-md border border-border px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                @click="cancelNewFolder"
              >
                {{ t('common.cancel') }}
              </button>
            </div>
          </div>
          <p v-if="createError" class="mt-2 text-sm text-destructive">{{ createError }}</p>
        </div>

        <div class="min-h-0 flex-1 overflow-hidden">
          <div v-if="loading" class="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
            <Loader2 :size="24" class="animate-spin" />
            <p class="text-sm">{{ t('library.folderPicker.loading') }}</p>
          </div>

          <div v-else-if="error" class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <FolderOpen :size="30" class="text-muted-foreground/60" />
            <p class="text-sm text-muted-foreground">{{ error }}</p>
            <button type="button" class="h-10 rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted" @click="reloadCurrent">
              {{ t('reader.retry') }}
            </button>
          </div>

          <div v-else class="flex h-full min-h-0 flex-col">
            <label
              class="flex h-11 shrink-0 cursor-pointer items-center gap-2.5 border-b border-border bg-muted/15 px-3 transition-colors hover:bg-muted/40"
              :class="[isSelected(currentPath) ? 'bg-primary/10' : '', isSelectionDisabled(currentPath) ? 'cursor-not-allowed opacity-60' : '']"
            >
              <input
                type="checkbox"
                class="size-4 shrink-0 accent-primary"
                :checked="isSelected(currentPath)"
                :disabled="isSelectionDisabled(currentPath)"
                @change="toggleCurrentPath"
              />
              <FolderOpen :size="17" class="shrink-0 text-primary" />
              <span class="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{{ t('library.folderPicker.selectCurrent') }}</span>
              <span class="max-w-40 truncate font-mono text-xs text-muted-foreground">{{ currentPath }}</span>
              <span
                v-if="existingPathStatus(currentPath) || selectedPathStatus(currentPath)"
                class="shrink-0 text-xs font-medium text-muted-foreground"
              >
                {{ existingPathStatus(currentPath) || selectedPathStatus(currentPath) }}
              </span>
            </label>

            <div v-if="filteredEntries.length === 0" class="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
              <Folder :size="28" class="text-muted-foreground/50" />
              <p class="text-sm font-medium text-foreground">
                {{ search ? t('library.folderPicker.noMatches') : t('library.folderPicker.empty') }}
              </p>
              <p class="text-sm text-muted-foreground">
                {{ search ? t('library.folderPicker.noMatchesHint') : t('library.folderPicker.emptyHint') }}
              </p>
            </div>

            <RecycleScroller v-else class="min-h-0 flex-1 overflow-y-auto" :items="filteredEntries" :item-size="40" key-field="path">
              <template #default="{ item: entry }">
                <div class="flex h-10 items-stretch border-b border-border/60 px-1.5 sm:px-2">
                  <label
                    class="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded px-2 transition-colors hover:bg-muted/50"
                    :class="isSelectionDisabled(entry.path) ? 'cursor-not-allowed opacity-60' : ''"
                  >
                    <input
                      type="checkbox"
                      class="size-4 shrink-0 accent-primary"
                      :checked="isSelected(entry.path)"
                      :disabled="isSelectionDisabled(entry.path)"
                      @change="toggleSelection(entry.path)"
                    />
                    <Folder :size="16" class="shrink-0 text-primary/80" />
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-sm font-medium text-foreground">{{ entry.name }}</span>
                      <span
                        v-if="existingPathStatus(entry.path) || selectedPathStatus(entry.path)"
                        class="block truncate text-xs text-muted-foreground"
                      >
                        {{ existingPathStatus(entry.path) || selectedPathStatus(entry.path) }}
                      </span>
                    </span>
                  </label>
                  <button
                    type="button"
                    class="flex size-10 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    :aria-label="t('library.folderPicker.openFolderAria', { name: entry.name })"
                    @click="navigate(entry.path)"
                  >
                    <ChevronRight :size="16" />
                  </button>
                </div>
              </template>
            </RecycleScroller>
          </div>
        </div>

        <footer class="shrink-0 border-t border-border bg-card px-3 py-2.5">
          <div v-if="selectionNotice" class="mb-2 flex items-start gap-2 text-xs text-muted-foreground">
            <Info :size="14" class="shrink-0 text-primary" />
            <span>{{ selectionNotice }}</span>
          </div>
          <div class="flex items-center justify-between gap-3">
            <p class="text-sm text-muted-foreground">
              {{ t('library.folderPicker.selectedCount', { count: selectedCount }, selectedCount) }}
            </p>
            <div class="flex shrink-0 items-center gap-2">
              <button
                type="button"
                class="h-9 rounded-md border border-border px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                @click="requestClose"
              >
                {{ t('common.cancel') }}
              </button>
              <button
                type="button"
                class="flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                :disabled="selectedCount === 0"
                @click="addSelectedFolders"
              >
                <Check :size="16" />
                {{ addButtonLabel }}
              </button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style>
@import 'vue-virtual-scroller/dist/vue-virtual-scroller.css';
</style>
