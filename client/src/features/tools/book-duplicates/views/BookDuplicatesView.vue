<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { AlertCircle, CopyCheck, Info, Loader2, Search, SlidersHorizontal } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import type { BookDuplicateMatchReason } from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { formatNumber } from '@/i18n/formatters'
import { useBookDuplicates } from '../../composables/useBookDuplicates'
import DeleteDuplicateBooksDialog from '../components/DeleteDuplicateBooksDialog.vue'
import DuplicateBookGroupCard from '../components/DuplicateBookGroupCard.vue'

const { t } = useI18n()
const { libraries, fetchLibraries } = useLibraries()
const { hasPermission } = usePermissions()
const duplicates = useBookDuplicates()
const selectedLibraryId = ref('')
const similarityPercent = ref(85)
const selectedReason = ref<BookDuplicateMatchReason | ''>('')
const pendingGroupId = ref<number | null>(null)
const pendingBookIds = ref<number[]>([])
const resultsViewportRef = ref<HTMLElement | null>(null)
const libraryScopeRef = ref<HTMLSelectElement | null>(null)

const scanFinished = computed(() => duplicates.scan.value?.status === 'completed')
const canUseTool = computed(() => hasPermission('library_delete_books'))
const progressStyle = computed(() => ({ width: `${duplicates.scan.value?.progressPercent ?? 0}%` }))

onMounted(() => {
  void Promise.all([fetchLibraries(), duplicates.resumeActiveScan()])
})

function handleStartScan(): void {
  const libraryId = selectedLibraryId.value ? Number(selectedLibraryId.value) : undefined
  void duplicates.startScan(libraryId, similarityPercent.value)
}

function handleReasonChange(): void {
  void duplicates.setReason(selectedReason.value || undefined)
}

function handleResolve(groupId: number, bookIds: number[]): void {
  pendingGroupId.value = groupId
  pendingBookIds.value = bookIds
}

function handleDismiss(groupId: number): void {
  duplicates.hideGroup(groupId)
}

function handleCancelDelete(): void {
  pendingGroupId.value = null
  pendingBookIds.value = []
}

async function handleConfirmDelete(): Promise<void> {
  if (pendingGroupId.value === null) return
  const deleted = await duplicates.discardBooks(pendingBookIds.value)
  if (deleted) handleCancelDelete()
}

function handlePreviousPage(): void {
  void duplicates.setPage(duplicates.page.value - 1)
}

function handleNextPage(): void {
  void duplicates.setPage(duplicates.page.value + 1)
}

function handleShowScanSettings(): void {
  resultsViewportRef.value?.scrollTo({ top: 0 })
  libraryScopeRef.value?.focus({ preventScroll: true })
}
</script>

<template>
  <div v-if="!canUseTool" role="alert" class="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
    {{ t('tools.bookDuplicates.accessDenied') }}
  </div>
  <div ref="resultsViewportRef" v-else class="flex h-full min-h-0 w-full flex-col gap-4 overflow-y-auto pr-1">
    <section class="shrink-0 rounded-lg border border-border/70 bg-card/50 p-4">
      <div class="flex flex-col gap-3">
        <div class="grid gap-3 lg:grid-cols-[minmax(16rem,1fr)_minmax(16rem,20rem)_auto] lg:items-end">
          <label class="grid min-w-0 gap-1.5 text-sm font-medium text-foreground" for="duplicate-library-scope">
            <span>{{ t('tools.bookDuplicates.scope') }}</span>
            <select
              ref="libraryScopeRef"
              id="duplicate-library-scope"
              v-model="selectedLibraryId"
              class="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
              :disabled="duplicates.scanning.value"
            >
              <option value="">{{ t('tools.bookDuplicates.allLibraries') }}</option>
              <option v-for="library in libraries" :key="library.id" :value="String(library.id)">{{ library.name }}</option>
            </select>
          </label>

          <div class="grid gap-1.5">
            <div class="flex items-center justify-between gap-3 text-sm font-medium text-foreground">
              <div class="flex items-center gap-1.5">
                <label for="duplicate-title-threshold">{{ t('tools.bookDuplicates.similarity') }}</label>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <button
                      type="button"
                      class="rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      :aria-label="t('tools.bookDuplicates.explainSimilarity')"
                    >
                      <Info class="size-4" aria-hidden="true" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" class="max-w-sm leading-relaxed">
                    {{ t('tools.bookDuplicates.similarityHelp') }}
                  </TooltipContent>
                </Tooltip>
              </div>
              <output for="duplicate-title-threshold" class="tabular-nums">{{ formatNumber(similarityPercent) }}%</output>
            </div>
            <input
              id="duplicate-title-threshold"
              v-model.number="similarityPercent"
              type="range"
              min="70"
              max="100"
              step="1"
              class="h-10 w-full accent-primary"
              :disabled="duplicates.scanning.value"
            />
          </div>

          <Button class="h-10" :disabled="duplicates.scanning.value || duplicates.loading.value" @click="handleStartScan">
            <Loader2 v-if="duplicates.scanning.value" class="animate-spin" aria-hidden="true" />
            <Search v-else aria-hidden="true" />
            {{ scanFinished ? t('tools.bookDuplicates.rescan') : t('tools.bookDuplicates.runScan') }}
          </Button>
        </div>

        <p class="text-sm text-muted-foreground">
          {{ t('tools.bookDuplicates.description') }}
        </p>

        <div v-if="duplicates.scanning.value" role="status" aria-live="polite">
          <div class="mb-1 flex justify-between text-sm text-muted-foreground">
            <span>{{ t(`tools.bookDuplicates.status.${duplicates.scan.value?.status ?? 'queued'}`) }}</span>
            <span>{{ formatNumber(duplicates.scan.value?.progressPercent ?? 0) }}%</span>
          </div>
          <div class="h-2 overflow-hidden rounded-full bg-muted">
            <div class="h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none" :style="progressStyle" />
          </div>
        </div>
      </div>
    </section>

    <div
      v-if="duplicates.error.value"
      role="alert"
      class="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
    >
      <AlertCircle class="size-4" aria-hidden="true" />
      {{ duplicates.error.value }}
    </div>

    <section v-if="scanFinished" class="flex flex-1 flex-col">
      <div
        class="sticky top-0 z-10 mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/70 bg-background/95 px-3 py-2 shadow-sm backdrop-blur-sm"
      >
        <p class="text-sm text-muted-foreground">
          {{ t('tools.bookDuplicates.groupsFound', { count: duplicates.total.value }, duplicates.total.value) }}
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" @click="handleShowScanSettings">
            <SlidersHorizontal aria-hidden="true" />
            {{ t('tools.bookDuplicates.scanSettings') }}
          </Button>
          <label class="flex items-center gap-2 text-sm font-medium text-foreground">
            {{ t('tools.bookDuplicates.filter') }}
            <select
              v-model="selectedReason"
              class="h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              @change="handleReasonChange"
            >
              <option value="">{{ t('tools.bookDuplicates.allReasons') }}</option>
              <option value="file_hash">{{ t('tools.bookDuplicates.reasons.file_hash') }}</option>
              <option value="isbn">{{ t('tools.bookDuplicates.reasons.isbn') }}</option>
              <option value="exact_metadata">{{ t('tools.bookDuplicates.reasons.exact_metadata') }}</option>
              <option value="fuzzy_metadata">{{ t('tools.bookDuplicates.reasons.fuzzy_metadata') }}</option>
            </select>
          </label>
        </div>
      </div>

      <div v-if="duplicates.loading.value" class="flex flex-1 items-center justify-center" role="status">
        <Loader2 class="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
        <span class="sr-only">{{ t('common.loading') }}</span>
      </div>
      <div
        v-else-if="duplicates.visibleGroups.value.length === 0"
        class="flex flex-1 flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border/60 bg-card/20 p-10 text-center"
      >
        <div class="flex h-14 w-14 items-center justify-center rounded-full bg-muted/70">
          <CopyCheck class="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        </div>
        <div class="space-y-1">
          <p class="text-base font-semibold text-foreground">{{ t('tools.bookDuplicates.empty.title') }}</p>
          <p class="max-w-md text-sm text-muted-foreground">{{ t('tools.bookDuplicates.empty.description') }}</p>
        </div>
      </div>
      <div v-else class="space-y-4">
        <DuplicateBookGroupCard
          v-for="group in duplicates.visibleGroups.value"
          :key="group.id"
          :group="group"
          @resolve="handleResolve"
          @dismiss="handleDismiss"
        />
      </div>

      <nav
        v-if="duplicates.totalPages.value > 1"
        class="mt-3 flex items-center justify-center gap-3"
        :aria-label="t('tools.bookDuplicates.pagination.label')"
      >
        <Button variant="outline" size="sm" :disabled="duplicates.page.value <= 1 || duplicates.loading.value" @click="handlePreviousPage">
          {{ t('common.previous') }}
        </Button>
        <span class="text-sm text-muted-foreground">
          {{ t('tools.bookDuplicates.pagination.page', { page: duplicates.page.value, total: duplicates.totalPages.value }) }}
        </span>
        <Button
          variant="outline"
          size="sm"
          :disabled="duplicates.page.value >= duplicates.totalPages.value || duplicates.loading.value"
          @click="handleNextPage"
        >
          {{ t('common.next') }}
        </Button>
      </nav>
    </section>

    <section
      v-else-if="!duplicates.scanning.value && !duplicates.error.value"
      class="flex flex-1 flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border/60 bg-card/20 p-10 text-center"
    >
      <div class="flex h-14 w-14 items-center justify-center rounded-full bg-muted/70">
        <Search class="h-6 w-6 text-muted-foreground" aria-hidden="true" />
      </div>
      <div class="space-y-1">
        <p class="text-base font-semibold text-foreground">{{ t('tools.bookDuplicates.initial.title') }}</p>
        <p class="max-w-md text-sm text-muted-foreground">{{ t('tools.bookDuplicates.initial.description') }}</p>
      </div>
    </section>

    <DeleteDuplicateBooksDialog
      :open="pendingGroupId !== null"
      :count="pendingBookIds.length"
      :deleting="duplicates.deleting.value"
      @confirm="handleConfirmDelete"
      @cancel="handleCancelDelete"
    />
  </div>
</template>
