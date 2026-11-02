<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { AlertCircle, ListChecks } from '@lucide/vue'
import type { ChapterHealthCategory } from '@bookorbit/types'

import PaginationNav from '@/components/PaginationNav.vue'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/lib/api-json'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { useLibraryPermissions } from '@/features/library/composables/useLibraryPermissions'
import { useChapterHealth } from '../../composables/useChapterHealth'
import ChapterHealthCategoryTabs from '../components/ChapterHealthCategoryTabs.vue'
import ChapterHealthLookupPanel from '../components/ChapterHealthLookupPanel.vue'
import ChapterHealthRow from '../components/ChapterHealthRow.vue'

const { t } = useI18n()
const { hasPermission } = usePermissions()
const { libraries, fetchLibraries } = useLibraries()
const { hasLibraryPermission } = useLibraryPermissions()
const health = useChapterHealth()

const canUseTool = computed(() => hasPermission('library_edit_metadata'))
/** The tool changes chapters, so it offers only the libraries the user may edit. */
const editableLibraries = computed(() => libraries.value.filter((library) => hasLibraryPermission('library_edit_metadata', library.id, 'editor')))
const enqueueing = ref(false)
const showSkeleton = computed(() => health.loadingList.value && health.items.value.length === 0)
const selectable = computed(() => health.canLookUp.value)

onMounted(() => {
  if (!canUseTool.value) return
  void fetchLibraries()
  void health.refresh()
})

// The Tools tabs stay alive between visits: no polling while hidden, and fresh counts on return.
let activatedBefore = false
onActivated(() => {
  if (!activatedBefore) {
    activatedBefore = true
    return
  }
  if (canUseTool.value) void health.refresh()
})
onDeactivated(() => health.stop())

async function handleCategoryChange(next: ChapterHealthCategory) {
  await health.setCategory(next)
}

async function handleLibraryChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  await health.setLibrary(value === '' ? null : Number(value))
}

async function handlePageChange(next: number) {
  await health.setPage(next)
}

function handleToggle(bookId: number) {
  health.toggle(bookId)
}

function handleClearSelection() {
  health.clearSelection()
}

async function handleLookUp() {
  enqueueing.value = true
  try {
    const result = await health.lookUp()
    toast.success(
      result.skipped > 0
        ? t('tools.chapterHealth.lookup.queuedWithSkipped', { count: result.queued, skipped: result.skipped })
        : t('tools.chapterHealth.lookup.queued', { count: result.queued }),
    )
  } catch (reason) {
    toast.error(errorMessage(reason, 'tools.chapterHealth.errors.enqueue'))
  } finally {
    enqueueing.value = false
  }
}

async function handleCancel() {
  try {
    await health.cancel()
  } catch (reason) {
    toast.error(errorMessage(reason, 'tools.chapterHealth.errors.cancel'))
  }
}

async function handleClearFinished() {
  try {
    await health.clearFinished()
  } catch (reason) {
    toast.error(errorMessage(reason, 'tools.chapterHealth.errors.cancel'))
  }
}

async function handleDismiss(bookId: number) {
  try {
    await health.dismiss(bookId)
  } catch (reason) {
    toast.error(errorMessage(reason, 'tools.chapterHealth.errors.dismiss'))
  }
}
</script>

<template>
  <div v-if="!canUseTool" role="alert" class="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
    {{ t('tools.chapterHealth.accessDenied') }}
  </div>

  <div v-else class="flex h-full min-h-0 w-full flex-col gap-4 overflow-y-auto pr-1">
    <ChapterHealthLookupPanel
      :lookup="health.lookup.value"
      :candidates="health.lookupCandidates.value"
      :selected-count="health.selected.value.size"
      :can-look-up="health.canLookUp.value"
      :busy="enqueueing"
      @look-up="handleLookUp"
      @cancel="handleCancel"
      @clear-finished="handleClearFinished"
    />

    <div
      v-if="health.error.value"
      role="alert"
      class="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
    >
      <AlertCircle class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{{ health.error.value }}</span>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-3">
      <ChapterHealthCategoryTabs :model-value="health.category.value" :summary="health.summary.value" @update:model-value="handleCategoryChange" />
      <label v-if="editableLibraries.length > 1" class="flex items-center gap-2 text-sm text-muted-foreground">
        {{ t('tools.chapterHealth.library') }}
        <select
          class="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          :value="health.libraryId.value ?? ''"
          @change="handleLibraryChange"
        >
          <option value="">{{ t('tools.chapterHealth.allLibraries') }}</option>
          <option v-for="library in editableLibraries" :key="library.id" :value="library.id">{{ library.name }}</option>
        </select>
      </label>
    </div>

    <p class="text-sm text-muted-foreground">{{ t(`tools.chapterHealth.hints.${health.category.value}`) }}</p>

    <section class="flex min-h-0 flex-1 flex-col gap-3">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="text-sm text-muted-foreground" aria-live="polite">{{ t('tools.chapterHealth.found', { count: health.total.value }) }}</p>
        <Button v-if="health.selected.value.size > 0" variant="ghost" size="sm" @click="handleClearSelection">
          {{ t('tools.chapterHealth.clearSelection') }}
        </Button>
      </div>

      <div v-if="showSkeleton" class="space-y-2" aria-hidden="true">
        <div v-for="index in 5" :key="index" class="h-14 animate-pulse rounded-md bg-muted/50 motion-reduce:animate-none" />
      </div>

      <div
        v-else-if="health.items.value.length === 0"
        class="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border/60 bg-card/20 p-10 text-center"
      >
        <div class="flex size-12 items-center justify-center rounded-full bg-muted/70">
          <ListChecks class="size-5 text-muted-foreground" aria-hidden="true" />
        </div>
        <p class="text-sm font-medium text-foreground">{{ t('tools.chapterHealth.emptyTitle') }}</p>
      </div>

      <ul v-else class="divide-y divide-border rounded-lg border border-border bg-card">
        <ChapterHealthRow
          v-for="book in health.items.value"
          :key="book.bookId"
          :book="book"
          :selectable="selectable"
          :selected="health.selected.value.has(book.bookId)"
          @toggle="handleToggle"
          @dismiss="handleDismiss"
        />
      </ul>

      <PaginationNav
        v-if="health.pageCount.value > 1"
        :page="health.page.value"
        :total-pages="health.pageCount.value"
        @update:page="handlePageChange"
      />
    </section>
  </div>
</template>
