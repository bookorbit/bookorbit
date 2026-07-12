<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Download, FileJson2, FileSpreadsheet, Loader2, X } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { SortSpec } from '@bookorbit/types'
import {
  useBookMetadataExport,
  type MetadataExportColumnsMode,
  type MetadataExportFormat,
  type MetadataExportQuery,
  type MetadataExportRequest,
  type MetadataExportScope,
  type MetadataExportViewType,
  type MetadataExportPreflight,
} from '@/features/book/composables/useBookMetadataExport'
import { useI18n } from 'vue-i18n'
import { formatNumber } from '@/i18n/formatters'

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    open: boolean
    viewType: MetadataExportViewType
    selectedBookIds: number[]
    selectedCount: number
    totalCount: number
    allMatchingQuery?: MetadataExportQuery
    sort?: SortSpec[]
    visibleColumns?: string[]
    defaultScope?: MetadataExportScope
  }>(),
  {
    defaultScope: 'all-matching',
    sort: () => [],
    visibleColumns: () => [],
  },
)

const emit = defineEmits<{ 'update:open': [value: boolean] }>()

type PersistedSettings = {
  format: MetadataExportFormat
  columnsMode: MetadataExportColumnsMode
  includePersonalData: boolean
  includeFilePaths: boolean
  includeContextMeta: boolean
}

const STORAGE_PREFIX = 'bookorbit:metadata-export:'

const settings = reactive<PersistedSettings>({
  format: 'csv',
  columnsMode: 'canonical',
  includePersonalData: false,
  includeFilePaths: false,
  includeContextMeta: true,
})

const scope = ref<MetadataExportScope>('all-matching')
const preflight = ref<MetadataExportPreflight | null>(null)
const preflightError = ref<string | null>(null)
const preflighting = ref(false)
const { loading, preflight: requestPreflight, download } = useBookMetadataExport()

const selectedCountLabel = computed(() => formatNumber(props.selectedCount))
const totalCountLabel = computed(() => formatNumber(props.totalCount))
const hasSelectedRows = computed(() => props.selectedBookIds.length > 0)
const hasAllMatchingScope = computed(() => Boolean(props.allMatchingQuery))

const canRun = computed(() => {
  if (scope.value === 'selected') return hasSelectedRows.value
  return hasAllMatchingScope.value
})

const scopeSummary = computed(() => {
  if (scope.value === 'selected') return t('book.export.selectedRowsSummary', { count: selectedCountLabel.value }, props.selectedCount)
  return t('book.export.matchingRowsSummary', { count: totalCountLabel.value }, props.totalCount)
})

const sizeHintClass = computed(() => {
  if (!preflight.value) return 'text-muted-foreground'
  if (preflight.value.sizeCategory === 'small') return 'text-emerald-600'
  if (preflight.value.sizeCategory === 'medium') return 'text-amber-600'
  return 'text-destructive'
})

function storageKey(viewType: MetadataExportViewType) {
  return `${STORAGE_PREFIX}${viewType}`
}

function loadSettings() {
  if (typeof window === 'undefined') return
  try {
    const raw = window.localStorage.getItem(storageKey(props.viewType))
    if (!raw) return
    const parsed = JSON.parse(raw) as Partial<PersistedSettings>
    if (parsed.format === 'csv' || parsed.format === 'json') settings.format = parsed.format
    if (parsed.columnsMode === 'canonical' || parsed.columnsMode === 'visible') settings.columnsMode = parsed.columnsMode
    if (typeof parsed.includePersonalData === 'boolean') settings.includePersonalData = parsed.includePersonalData
    if (typeof parsed.includeFilePaths === 'boolean') settings.includeFilePaths = parsed.includeFilePaths
    if (typeof parsed.includeContextMeta === 'boolean') settings.includeContextMeta = parsed.includeContextMeta
  } catch {
    // Ignore malformed persisted state.
  }
}

function persistSettings() {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(storageKey(props.viewType), JSON.stringify(settings))
}

function closeDialog() {
  emit('update:open', false)
}

function resolveDefaultScope(): MetadataExportScope {
  const preferred = props.defaultScope
  if (preferred === 'selected' && hasSelectedRows.value) return 'selected'
  if (preferred === 'all-matching' && hasAllMatchingScope.value) return 'all-matching'
  if (hasSelectedRows.value) return 'selected'
  return 'all-matching'
}

function buildRequest(): MetadataExportRequest | null {
  if (!canRun.value) return null
  return {
    scope: scope.value,
    format: settings.format,
    viewType: props.viewType,
    selectedBookIds: props.selectedBookIds,
    allMatchingQuery: props.allMatchingQuery,
    sort: props.sort,
    options: {
      includePersonalData: settings.includePersonalData,
      includeFilePaths: settings.includeFilePaths,
      includeContextMeta: settings.includeContextMeta,
      columnsMode: settings.columnsMode,
      visibleColumns: props.visibleColumns ?? [],
    },
  }
}

async function refreshPreflight() {
  preflight.value = null
  preflightError.value = null
  const request = buildRequest()
  if (!request) return
  preflighting.value = true
  try {
    preflight.value = await requestPreflight(request)
  } catch (error) {
    preflightError.value = error instanceof Error ? error.message : t('book.export.prepareFailed')
  } finally {
    preflighting.value = false
  }
}

async function runExport() {
  const request = buildRequest()
  if (!request) return
  if (!preflight.value || preflightError.value) {
    await refreshPreflight()
    if (!preflight.value || preflightError.value) return
  }

  try {
    await download(request)
    toast.success(t('book.export.exportStarted', { fileName: preflight.value.fileName }))
    closeDialog()
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('book.export.exportFailed'))
  }
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    loadSettings()
    scope.value = resolveDefaultScope()
    void refreshPreflight()
  },
)

watch(
  [
    () => props.open,
    scope,
    () => settings.format,
    () => settings.columnsMode,
    () => settings.includePersonalData,
    () => settings.includeFilePaths,
    () => settings.includeContextMeta,
  ],
  ([open]) => {
    if (!open) return
    persistSettings()
    void refreshPreflight()
  },
)

watch(
  () => props.viewType,
  () => {
    if (!props.open) return
    loadSettings()
    void refreshPreflight()
  },
)
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="closeDialog" />
      <div class="relative z-10 mx-4 w-full max-w-2xl rounded-lg border border-border bg-card shadow-2xl">
        <div class="flex items-center justify-between border-b border-border px-5 py-4">
          <div class="flex items-center gap-2">
            <FileSpreadsheet :size="16" class="text-primary" />
            <h2 class="text-base font-semibold text-foreground">{{ t('book.export.title') }}</h2>
          </div>
          <button class="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" @click="closeDialog">
            <X :size="14" />
          </button>
        </div>

        <div class="space-y-5 px-5 py-4">
          <section class="space-y-2">
            <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{{ t('book.export.scope') }}</p>
            <div class="grid gap-2 sm:grid-cols-2">
              <button
                class="rounded-md border px-3 py-2 text-left text-sm transition-colors"
                :class="
                  scope === 'selected' ? 'border-primary bg-primary/10 text-primary' : 'border-input bg-background text-foreground hover:bg-muted/40'
                "
                :disabled="!hasSelectedRows"
                @click="scope = 'selected'"
              >
                <p class="font-medium">{{ t('book.export.selectedRows') }}</p>
                <p class="text-xs text-muted-foreground">{{ t('book.export.currentlySelected', { count: selectedCountLabel }) }}</p>
              </button>
              <button
                class="rounded-md border px-3 py-2 text-left text-sm transition-colors"
                :class="
                  scope === 'all-matching'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-input bg-background text-foreground hover:bg-muted/40'
                "
                :disabled="!hasAllMatchingScope"
                @click="scope = 'all-matching'"
              >
                <p class="font-medium">{{ t('book.export.allMatchingRows') }}</p>
                <p class="text-xs text-muted-foreground">{{ t('book.export.rowsInResult', { count: totalCountLabel }) }}</p>
              </button>
            </div>
          </section>

          <section class="space-y-2">
            <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{{ t('book.export.format') }}</p>
            <div class="grid gap-2 sm:grid-cols-2">
              <button
                class="rounded-md border px-3 py-2 text-left text-sm transition-colors"
                :class="
                  settings.format === 'csv'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-input bg-background text-foreground hover:bg-muted/40'
                "
                @click="settings.format = 'csv'"
              >
                <p class="flex items-center gap-1.5 font-medium"><FileSpreadsheet :size="14" /> CSV</p>
                <p class="text-xs text-muted-foreground">{{ t('book.export.csvDescription') }}</p>
              </button>
              <button
                class="rounded-md border px-3 py-2 text-left text-sm transition-colors"
                :class="
                  settings.format === 'json'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-input bg-background text-foreground hover:bg-muted/40'
                "
                @click="settings.format = 'json'"
              >
                <p class="flex items-center gap-1.5 font-medium"><FileJson2 :size="14" /> JSON</p>
                <p class="text-xs text-muted-foreground">{{ t('book.export.jsonDescription') }}</p>
              </button>
            </div>
          </section>

          <section class="space-y-2">
            <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{{ t('book.export.columns') }}</p>
            <div class="flex flex-wrap items-center gap-4 text-sm">
              <label class="inline-flex items-center gap-2">
                <input type="radio" class="accent-primary" value="canonical" v-model="settings.columnsMode" />
                {{ t('book.export.canonicalSchema') }}
              </label>
              <label class="inline-flex items-center gap-2">
                <input type="radio" class="accent-primary" value="visible" v-model="settings.columnsMode" />
                {{ t('book.export.visibleColumns') }}
              </label>
            </div>
          </section>

          <section class="space-y-2">
            <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{{ t('book.export.options') }}</p>
            <div class="grid gap-2 text-sm sm:grid-cols-2">
              <label class="inline-flex items-center gap-2">
                <input v-model="settings.includePersonalData" type="checkbox" class="accent-primary" />
                {{ t('book.export.includePersonalData') }}
              </label>
              <label class="inline-flex items-center gap-2">
                <input v-model="settings.includeFilePaths" type="checkbox" class="accent-primary" />
                {{ t('book.export.includeFilePaths') }}
              </label>
              <label class="inline-flex items-center gap-2">
                <input v-model="settings.includeContextMeta" type="checkbox" class="accent-primary" />
                {{ t('book.export.includeContextMeta') }}
              </label>
            </div>
          </section>

          <section class="rounded-md border border-border/70 bg-muted/30 p-3 text-sm">
            <p class="font-medium text-foreground">{{ t('book.export.preflight') }}</p>
            <p class="mt-1 text-muted-foreground">{{ t('book.export.scopeLabel', { summary: scopeSummary }) }}</p>
            <p v-if="preflighting" class="mt-1 inline-flex items-center gap-2 text-muted-foreground">
              <Loader2 :size="14" class="animate-spin" /> {{ t('book.export.calculatingSize') }}
            </p>
            <template v-else-if="preflight">
              <p class="mt-1 text-muted-foreground">
                {{ t('book.export.estimatedSize') }}
                <span :class="sizeHintClass">{{ (preflight.estimatedBytes / 1024 / 1024).toFixed(2) }} MB</span>
                ({{ preflight.sizeCategory }})
              </p>
              <p class="mt-1 text-muted-foreground">{{ t('book.export.fileLabel', { fileName: preflight.fileName }) }}</p>
            </template>
            <p v-else-if="preflightError" class="mt-1 text-destructive">{{ preflightError }}</p>
          </section>
        </div>

        <div class="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
          <button
            class="rounded-md px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            :disabled="loading"
            @click="closeDialog"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            class="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            :disabled="!canRun || !!preflightError || loading || preflighting"
            @click="runExport"
          >
            <Loader2 v-if="loading" :size="14" class="animate-spin" />
            <Download v-else :size="14" />
            {{ t('book.export.exportAction') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
