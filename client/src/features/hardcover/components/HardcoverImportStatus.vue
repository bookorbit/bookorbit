<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertCircle, CheckCircle2, Download, FileSearch, Loader2, Table2, XCircle } from '@lucide/vue'
import { toast } from 'vue-sonner'
import HardcoverImportReviewModal from './HardcoverImportReviewModal.vue'
import { useHardcoverImport } from '../composables/useHardcoverImport'
import { useHardcoverSettings } from '../composables/useHardcoverSettings'

const { t } = useI18n()

const { settings } = useHardcoverSettings()
const { preview, result, previewing, applying, error, loadPreview, applyPreview, clearImport } = useHardcoverImport()

const reviewOpen = ref(false)
const importProgress = ref(true)

const importUnavailableReason = computed(() => {
  switch (settings.value?.disabledReason) {
    case 'permission_denied':
      return t('hardcover.import.unavailable.permissionDenied')
    case 'missing_token':
      return t('hardcover.import.unavailable.missingToken')
    case 'user_disabled':
      return t('hardcover.import.unavailable.userDisabled')
    default:
      return null
  }
})

const previewButtonDisabled = computed(() => previewing.value || applying.value || importUnavailableReason.value !== null)
const readyRows = computed(() => preview.value?.rows.filter((row) => row.outcome === 'will_update') ?? [])
const canImportReady = computed(() => readyRows.value.length > 0 && !previewing.value && !applying.value)
const summaryItems = computed(() => {
  const summary = preview.value?.summary
  if (!summary) return []
  return [
    { label: t('hardcover.import.summary.ready'), value: summary.willUpdate },
    { label: t('hardcover.import.summary.review'), value: summary.needsReview },
    { label: t('hardcover.import.summary.conflicts'), value: summary.conflicts },
    { label: t('hardcover.import.summary.unmatched'), value: summary.unmatched },
    { label: t('hardcover.import.summary.skipped'), value: summary.skipped },
  ]
})
const progressPreviewLabel = computed(() => {
  const summary = preview.value?.summary
  if (!summary) return null
  const ready = t('hardcover.import.progressAvailable', { count: summary.progressWillUpdate }, summary.progressWillUpdate)
  if (summary.progressConflicts === 0) return ready
  return `${ready}, ${t('hardcover.import.progressConflicts', { count: summary.progressConflicts }, summary.progressConflicts)}`
})

const resultLabel = computed(() => {
  if (!result.value) return null
  const progress =
    result.value.progressApplied > 0 ? `, ${t('hardcover.import.result.progressUpdated', { count: result.value.progressApplied })}` : ''
  return t('hardcover.import.result.summary', { applied: result.value.applied, progress, failed: result.value.failed })
})

async function handlePreview(): Promise<void> {
  await loadPreview()
  if (preview.value) reviewOpen.value = true
}

function handleOpenReview(): void {
  reviewOpen.value = true
}

function handleCloseReview(): void {
  reviewOpen.value = false
}

function handleClear(): void {
  reviewOpen.value = false
  clearImport()
}

async function handleImportReady(): Promise<void> {
  await applyRows()
}

async function handleApplySelected(hardcoverUserBookIds: number[]): Promise<void> {
  await applyRows(hardcoverUserBookIds)
}

async function applyRows(hardcoverUserBookIds?: number[]): Promise<void> {
  const applied = await applyPreview(hardcoverUserBookIds, importProgress.value)
  if (!applied) {
    toast.error(error.value ?? t('hardcover.import.toast.importFailed'))
    return
  }
  reviewOpen.value = false
  const progress = importProgress.value
    ? `, ${t('hardcover.import.toast.progressUpdates', { count: applied.progressApplied }, applied.progressApplied)}`
    : ''
  toast.success(t('hardcover.import.toast.imported', { count: applied.applied, progress }, applied.applied))
}
</script>

<template>
  <div class="space-y-4 rounded-lg border border-border bg-card px-4 py-4 shadow-xs md:px-5 md:py-5">
    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0">
        <p class="text-sm font-medium">{{ t('hardcover.import.title') }}</p>
        <p class="mt-0.5 text-xs text-muted-foreground">{{ t('hardcover.import.description') }}</p>
        <p v-if="importUnavailableReason" class="mt-1 text-xs text-muted-foreground">{{ importUnavailableReason }}</p>
        <p v-else-if="resultLabel && !preview" class="mt-1 flex items-center gap-1 text-xs text-primary">
          <CheckCircle2 class="size-3.5" />
          {{ resultLabel }}
        </p>
        <p v-if="error" class="mt-1 flex items-center gap-1 text-xs text-destructive">
          <AlertCircle class="size-3.5" />
          {{ error }}
        </p>
      </div>

      <div class="flex shrink-0 flex-wrap justify-end gap-2">
        <button
          v-if="preview"
          type="button"
          class="flex items-center gap-1.5 rounded-md border border-border bg-muted px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/80"
          :disabled="previewing || applying"
          @click="handleClear"
        >
          <XCircle class="size-3.5" />
          {{ t('hardcover.import.clear') }}
        </button>
        <button
          type="button"
          :disabled="previewButtonDisabled"
          class="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
          @click="handlePreview"
        >
          <Loader2 v-if="previewing" class="size-3.5 animate-spin" />
          <FileSearch v-else class="size-3.5" />
          {{ t('hardcover.import.preview') }}
        </button>
      </div>
    </div>

    <div v-if="preview" class="space-y-4 border-t border-border pt-4">
      <div class="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-5">
        <div v-for="item in summaryItems" :key="item.label" class="min-w-0">
          <p class="text-[10px] uppercase tracking-wider text-muted-foreground">{{ item.label }}</p>
          <p class="text-lg font-semibold tabular-nums">{{ item.value }}</p>
        </div>
      </div>

      <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div class="space-y-2">
          <p class="text-xs text-muted-foreground">{{ t('hardcover.import.exactMatches', { count: readyRows.length }, readyRows.length) }}</p>
          <label class="flex w-fit items-center gap-2 text-xs text-muted-foreground">
            <input
              v-model="importProgress"
              type="checkbox"
              class="size-4 rounded border-border text-primary focus:ring-primary/40"
              :disabled="applying"
            />
            <span>{{ t('hardcover.import.importProgress') }}</span>
            <span v-if="progressPreviewLabel">({{ progressPreviewLabel }})</span>
          </label>
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted"
            @click="handleOpenReview"
          >
            <Table2 class="size-3.5" />
            {{ t('hardcover.import.reviewMatches') }}
          </button>
          <button
            type="button"
            :disabled="!canImportReady"
            class="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
            @click="handleImportReady"
          >
            <Loader2 v-if="applying" class="size-3.5 animate-spin" />
            <Download v-else class="size-3.5" />
            {{ t('hardcover.import.importReady') }}
          </button>
        </div>
      </div>
    </div>

    <HardcoverImportReviewModal
      v-if="preview && reviewOpen"
      :preview="preview"
      :applying="applying"
      v-model:import-progress="importProgress"
      @close="handleCloseReview"
      @apply="handleApplySelected"
    />
  </div>
</template>
