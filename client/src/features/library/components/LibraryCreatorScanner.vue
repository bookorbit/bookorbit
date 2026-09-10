<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Lock, Plus, RefreshCw, X } from '@lucide/vue'
import type { AddedAtRecomputeJob, AddedAtSource, OrganizationMode } from '@bookorbit/types'
import { formatNumber } from '@/i18n/formatters'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { FORMAT_LABELS } from '../composables/useLibraryCreator'

const { t } = useI18n()

const props = defineProps<{
  organizationMode: OrganizationMode
  organizationModeLocked?: boolean
  allowedFormats: string[]
  addedAtSource: AddedAtSource
  canRecomputeAddedAt?: boolean
  storedAddedAtSource?: AddedAtSource | null
  recomputingAddedAt?: boolean
  recomputeJob?: AddedAtRecomputeJob | null
  recomputeErrorKey?: string | null
  excludePatterns: string[]
}>()

const emit = defineEmits<{
  'update:organizationMode': [value: OrganizationMode]
  'update:allowedFormats': [value: string[]]
  'update:addedAtSource': [value: AddedAtSource]
  'update:excludePatterns': [value: string[]]
  recompute: []
}>()

const confirmingRecompute = ref(false)
const confirmButton = ref<HTMLButtonElement | null>(null)
const sourceGroup = ref<HTMLElement | null>(null)
const recomputeButton = ref<HTMLButtonElement | null>(null)
const progressText = computed(() => {
  const job = props.recomputeJob
  if (!job) return ''
  const counters = ['processed', 'total', 'updated', 'unchanged', 'skipped', 'failed'] as const
  return t('library.creator.scanner.addedAt.progressSummary', Object.fromEntries(counters.map((key) => [key, formatNumber(job[key])])))
})

const ADDED_AT_SOURCES: AddedAtSource[] = ['imported', 'file_modified', 'file_created']

const recomputeDisabled = computed(
  () =>
    props.recomputingAddedAt ||
    !props.storedAddedAtSource ||
    props.storedAddedAtSource === 'imported' ||
    props.addedAtSource !== props.storedAddedAtSource,
)
const showSaveFirstHint = computed(() => props.canRecomputeAddedAt && props.addedAtSource !== props.storedAddedAtSource)

function selectAddedAtSource(source: AddedAtSource) {
  emit('update:addedAtSource', source)
}

async function requestRecompute() {
  confirmingRecompute.value = true
  await nextTick()
  confirmButton.value?.focus()
}

async function cancelRecompute() {
  confirmingRecompute.value = false
  await nextTick()
  recomputeButton.value?.focus()
}

async function confirmRecompute() {
  if (recomputeDisabled.value) return
  confirmingRecompute.value = false
  emit('recompute')
  await nextTick()
  sourceGroup.value?.querySelector<HTMLInputElement>('input:checked')?.focus()
}

// ── Scan mode ─────────────────────────────────────────────────────────────────

function handleSelectMode(mode: OrganizationMode) {
  if (props.organizationModeLocked) return
  emit('update:organizationMode', mode)
}

function handleSelectFolderMode() {
  handleSelectMode('book_per_folder')
}

function handleSelectFileMode() {
  handleSelectMode('book_per_file')
}

// ── Allowed formats ──────────────────────────────────────────────────────────

const ALL_FORMATS = Object.keys(FORMAT_LABELS)

function toggleAllowedFormat(fmt: string) {
  const current = [...props.allowedFormats]
  const idx = current.indexOf(fmt)
  if (idx === -1) {
    current.push(fmt)
  } else {
    if (current.length === 1) return
    current.splice(idx, 1)
  }
  emit('update:allowedFormats', current)
}

function selectAllFormats() {
  emit('update:allowedFormats', [])
}

// ── Exclude patterns ─────────────────────────────────────────────────────────

const newPattern = ref('')

function addPattern() {
  const trimmed = newPattern.value.trim()
  if (!trimmed || props.excludePatterns.includes(trimmed)) return
  emit('update:excludePatterns', [...props.excludePatterns, trimmed])
  newPattern.value = ''
}

function removePattern(i: number) {
  const updated = [...props.excludePatterns]
  updated.splice(i, 1)
  emit('update:excludePatterns', updated)
}

function onPatternKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    addPattern()
  }
}
</script>

<template>
  <div class="px-6 py-6 space-y-8">
    <!-- Scan mode -->
    <div>
      <div class="flex items-center gap-2 mb-3">
        <p class="text-[11px] font-semibold uppercase tracking-widest text-foreground">{{ t('library.creator.scanner.scanMode.title') }}</p>
        <Tooltip v-if="organizationModeLocked">
          <TooltipTrigger as-child>
            <span
              class="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border text-muted-foreground cursor-help"
              :aria-label="t('library.creator.scanner.scanMode.lockedAria')"
            >
              <Lock :size="11" />
            </span>
          </TooltipTrigger>
          <TooltipContent class="max-w-72 text-xs leading-relaxed">
            {{ t('library.creator.scanner.scanMode.lockTooltip') }}
          </TooltipContent>
        </Tooltip>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          type="button"
          class="text-left rounded-lg border p-4 transition-colors"
          :class="[
            organizationMode === 'book_per_folder'
              ? 'border-primary bg-primary/5 ring-1 ring-primary'
              : 'border-border bg-card hover:border-primary/40',
            organizationModeLocked ? 'cursor-not-allowed opacity-75' : '',
          ]"
          :disabled="organizationModeLocked"
          @click="handleSelectFolderMode"
        >
          <div class="flex items-center gap-2 mb-1.5">
            <span
              class="w-3.5 h-3.5 rounded-full border-2 shrink-0 flex items-center justify-center"
              :class="organizationMode === 'book_per_folder' ? 'border-primary' : 'border-muted-foreground/40'"
            >
              <span v-if="organizationMode === 'book_per_folder'" class="w-1.5 h-1.5 rounded-full bg-primary" />
            </span>
            <span class="text-sm font-semibold text-foreground">{{ t('library.creator.scanner.scanMode.folderAsBook.title') }}</span>
          </div>
          <p class="text-xs text-muted-foreground leading-relaxed">
            {{ t('library.creator.scanner.scanMode.folderAsBook.hint') }}
          </p>
        </button>

        <button
          type="button"
          class="text-left rounded-lg border p-4 transition-colors"
          :class="[
            organizationMode === 'book_per_file'
              ? 'border-primary bg-primary/5 ring-1 ring-primary'
              : 'border-border bg-card hover:border-primary/40',
            organizationModeLocked ? 'cursor-not-allowed opacity-75' : '',
          ]"
          :disabled="organizationModeLocked"
          @click="handleSelectFileMode"
        >
          <div class="flex items-center gap-2 mb-1.5">
            <span
              class="w-3.5 h-3.5 rounded-full border-2 shrink-0 flex items-center justify-center"
              :class="organizationMode === 'book_per_file' ? 'border-primary' : 'border-muted-foreground/40'"
            >
              <span v-if="organizationMode === 'book_per_file'" class="w-1.5 h-1.5 rounded-full bg-primary" />
            </span>
            <span class="text-sm font-semibold text-foreground">{{ t('library.creator.scanner.scanMode.fileAsBook.title') }}</span>
          </div>
          <p class="text-xs text-muted-foreground leading-relaxed">
            {{ t('library.creator.scanner.scanMode.fileAsBook.hint') }}
          </p>
        </button>
      </div>
    </div>

    <div>
      <p id="added-at-title" class="text-[11px] font-semibold uppercase tracking-widest text-foreground mb-1">
        {{ t('library.creator.scanner.addedAt.title') }}
      </p>
      <p id="added-at-hint" class="text-xs text-muted-foreground mb-3">{{ t('library.creator.scanner.addedAt.hint') }}</p>
      <div ref="sourceGroup" role="radiogroup" aria-labelledby="added-at-title" aria-describedby="added-at-hint" class="space-y-2">
        <label
          v-for="source in ADDED_AT_SOURCES"
          :key="source"
          class="block w-full cursor-pointer rounded-lg border p-3 text-start transition-colors focus-within:ring-2 focus-within:ring-ring"
          :class="addedAtSource === source ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border bg-card hover:border-primary/40'"
        >
          <span class="mb-1 flex items-center gap-2">
            <input
              type="radio"
              name="added-at-source"
              :value="source"
              :checked="addedAtSource === source"
              class="accent-primary"
              @change="selectAddedAtSource(source)"
            />
            <span class="text-sm font-semibold text-foreground">{{ t(`library.creator.scanner.addedAt.options.${source}.title`) }}</span>
          </span>
          <span class="block ps-5.5 text-xs text-muted-foreground leading-relaxed">{{
            t(`library.creator.scanner.addedAt.options.${source}.hint`)
          }}</span>
        </label>
      </div>
      <div v-if="canRecomputeAddedAt" class="mt-3 flex flex-wrap items-center gap-3">
        <button
          ref="recomputeButton"
          type="button"
          class="flex items-center gap-1.5 px-3 py-2 rounded-md border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="recomputeDisabled"
          @click="requestRecompute"
        >
          <RefreshCw :size="13" :class="recomputingAddedAt ? 'motion-safe:animate-spin' : ''" />
          {{ recomputingAddedAt ? t('library.creator.scanner.addedAt.recomputing') : t('library.creator.scanner.addedAt.recompute') }}
        </button>
        <p class="text-xs text-muted-foreground">
          {{ showSaveFirstHint ? t('library.creator.scanner.addedAt.recomputeSaveFirst') : t('library.creator.scanner.addedAt.recomputeHint') }}
        </p>
      </div>
      <div
        v-if="confirmingRecompute"
        role="group"
        :aria-label="t('library.creator.scanner.addedAt.recompute')"
        class="mt-3 rounded-md border border-border p-3"
      >
        <p class="text-sm text-muted-foreground">{{ t('library.creator.scanner.addedAt.backgroundConfirm') }}</p>
        <div class="mt-3 flex flex-wrap gap-2">
          <button
            ref="confirmButton"
            type="button"
            :disabled="recomputeDisabled"
            class="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            @click="confirmRecompute"
          >
            {{ t('library.creator.scanner.addedAt.recompute') }}
          </button>
          <button
            type="button"
            class="rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            @click="cancelRecompute"
          >
            {{ t('common.cancel') }}
          </button>
        </div>
      </div>
      <div v-if="recomputeJob" role="status" class="mt-3 space-y-2 text-sm text-muted-foreground">
        <p>{{ t(`library.creator.scanner.addedAt.jobStatus.${recomputeJob.status}`) }}</p>
        <progress
          v-if="recomputeJob.status === 'running'"
          :value="recomputeJob.total ? recomputeJob.processed : undefined"
          :max="recomputeJob.total || 1"
          :aria-label="t('library.creator.scanner.addedAt.recomputing')"
          class="h-2 w-full accent-primary"
        />
        <p>{{ progressText }}</p>
        <p v-if="recomputeJob.failed > 0">{{ t('library.creator.scanner.addedAt.failedBooksHint') }}</p>
        <ul v-if="recomputeJob.failureSamples.length" class="space-y-1">
          <li v-for="failure in recomputeJob.failureSamples" :key="failure.bookId">
            {{
              t('library.creator.scanner.addedAt.failureSample', {
                bookId: formatNumber(failure.bookId),
                reason: t(`library.creator.scanner.addedAt.failureReasons.${failure.code}`),
              })
            }}
          </li>
        </ul>
      </div>
      <p v-if="recomputeErrorKey" role="alert" class="mt-3 text-sm text-destructive">{{ t(recomputeErrorKey) }}</p>
    </div>

    <!-- Filtering group -->
    <div>
      <!-- Allowed formats -->
      <div class="mb-8">
        <div class="flex items-center justify-between mb-1">
          <p class="text-[11px] font-semibold uppercase tracking-widest text-foreground">
            {{ t('library.creator.scanner.allowedFormats.title') }}
          </p>
          <button
            v-if="allowedFormats.length > 0"
            type="button"
            class="text-xs text-muted-foreground hover:text-foreground transition-colors"
            @click="selectAllFormats"
          >
            {{ t('library.creator.scanner.allowedFormats.allowAll') }}
          </button>
        </div>
        <p class="text-xs text-muted-foreground mb-3">
          {{
            allowedFormats.length === 0
              ? t('library.creator.scanner.allowedFormats.allAllowed')
              : t('library.creator.scanner.allowedFormats.onlySelected')
          }}
        </p>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="fmt in ALL_FORMATS"
            :key="fmt"
            type="button"
            class="px-2.75 py-1 rounded-full text-[11px] font-medium border transition-colors"
            :class="
              allowedFormats.length === 0 || allowedFormats.includes(fmt)
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
            "
            :aria-pressed="allowedFormats.length === 0 || allowedFormats.includes(fmt)"
            @click="toggleAllowedFormat(fmt)"
          >
            {{ fmt.toUpperCase() }}
          </button>
        </div>
        <p v-if="allowedFormats.length > 0" class="mt-2 text-xs font-medium text-foreground">
          Books in other formats already in the library will be marked as missing on the next scan.
        </p>
      </div>

      <!-- Exclude patterns -->
      <div>
        <p class="text-[11px] font-semibold uppercase tracking-widest text-foreground mb-1">
          {{ t('library.creator.scanner.excludePatterns.title') }}
        </p>
        <p class="text-xs text-muted-foreground mb-3">
          {{ t('library.creator.scanner.excludePatterns.hintBefore') }} <code class="font-mono bg-muted px-1 rounded">**/samples/**</code
          >{{ t('library.creator.scanner.excludePatterns.hintAfter') }}
        </p>
        <div class="flex gap-2 mb-2">
          <input
            v-model="newPattern"
            type="text"
            placeholder="**/node_modules/**"
            class="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            @keydown="onPatternKeydown"
          />
          <button
            type="button"
            class="flex items-center gap-1.5 px-3 py-2 rounded-md border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
            :disabled="!newPattern.trim()"
            @click="addPattern"
          >
            <Plus :size="13" />
            {{ t('library.creator.scanner.excludePatterns.add') }}
          </button>
        </div>
        <div class="min-h-[40px] rounded-md border border-border bg-muted/30 p-2 flex flex-wrap gap-1.5 overflow-y-auto" style="max-height: 80px">
          <span v-if="excludePatterns.length === 0" class="text-xs text-muted-foreground self-center px-1">
            {{ t('library.creator.scanner.excludePatterns.empty') }}
          </span>
          <span
            v-for="(pattern, i) in excludePatterns"
            :key="pattern"
            class="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-background border border-border text-xs font-mono text-foreground"
          >
            {{ pattern }}
            <button
              type="button"
              class="text-muted-foreground hover:text-destructive transition-colors"
              :aria-label="`Remove exclude pattern ${pattern}`"
              @click="removePattern(i)"
            >
              <X :size="11" />
            </button>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
