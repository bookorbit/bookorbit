<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowRight, Lock, Plus, RefreshCw, TriangleAlert, X } from '@lucide/vue'
import { BOOK_FORMATS, type AddedAtRecomputeJob, type AddedAtSource, type OrganizationMode } from '@bookorbit/types'
import { formatNumber } from '@/i18n/formatters'
import { formatColorVar } from '@/features/book/lib/format-colors'
import { formatFamilyColor } from '@/features/settings/libraries/lib/library-formats'
import LibraryCreatorCard from './LibraryCreatorCard.vue'
import LibraryOrganizationPreview from './LibraryOrganizationPreview.vue'

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

const ORGANIZATION_MODES: OrganizationMode[] = ['book_per_folder', 'book_per_file']
const ADDED_AT_SOURCES: AddedAtSource[] = ['imported', 'file_modified', 'file_created']
const FORMAT_GROUPS: { id: 'ebook' | 'kindle' | 'document' | 'comic' | 'audio'; formats: string[] }[] = [
  { id: 'ebook', formats: ['epub', 'kepub', 'fb2'] },
  { id: 'kindle', formats: ['mobi', 'azw3', 'azw'] },
  { id: 'document', formats: ['pdf'] },
  { id: 'comic', formats: ['cbz', 'cbr', 'cb7'] },
  { id: 'audio', formats: ['m4b', 'mp3', 'm4a', 'opus', 'ogg', 'flac'] },
]

const modeCopy = computed<Record<OrganizationMode, { title: string; hint: string; result: string }>>(() => ({
  book_per_folder: {
    title: t('library.creator.scanner.scanMode.folderAsBook.title'),
    hint: t('library.creator.scanner.mode.folderHint'),
    result: t('library.creator.scanner.mode.folderResult'),
  },
  book_per_file: {
    title: t('library.creator.scanner.scanMode.fileAsBook.title'),
    hint: t('library.creator.scanner.mode.fileHint'),
    result: t('library.creator.scanner.mode.fileResult'),
  },
}))

// ── Import ────────────────────────────────────────────────────────────────────

const restricting = ref(props.allowedFormats.length > 0)
const importAll = computed(() => !restricting.value && props.allowedFormats.length === 0)

function isImported(format: string): boolean {
  return props.allowedFormats.length === 0 || props.allowedFormats.includes(format)
}

function selectImportAll() {
  restricting.value = false
  emit('update:allowedFormats', [])
}

function selectImportSome() {
  restricting.value = true
  if (props.allowedFormats.length === 0) emit('update:allowedFormats', [...BOOK_FORMATS])
}

function toggleFormat(format: string) {
  const current = props.allowedFormats.length === 0 ? [...BOOK_FORMATS] : [...props.allowedFormats]
  const index = current.indexOf(format)
  if (index === -1) current.push(format)
  else if (current.length > 1) current.splice(index, 1)
  else return
  emit('update:allowedFormats', current)
}

function chipStyle(format: string): Record<string, string> {
  if (!isImported(format)) return {}
  const color = formatColorVar(format)
  return { color, backgroundColor: `color-mix(in oklch, ${color} 13%, transparent)`, borderColor: 'transparent' }
}

// ── Skip patterns ───────────────────────────────────────────────────────────────

const newPattern = ref('')

function addPattern() {
  const trimmed = newPattern.value.trim()
  if (!trimmed || props.excludePatterns.includes(trimmed)) return
  emit('update:excludePatterns', [...props.excludePatterns, trimmed])
  newPattern.value = ''
}

function removePattern(pattern: string) {
  emit(
    'update:excludePatterns',
    props.excludePatterns.filter((candidate) => candidate !== pattern),
  )
}

function onPatternKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault()
    addPattern()
  }
}

// ── Organization ────────────────────────────────────────────────────────────────

function selectMode(event: Event) {
  if (props.organizationModeLocked) return
  emit('update:organizationMode', (event.target as HTMLInputElement).value as OrganizationMode)
}

// ── Date added ────────────────────────────────────────────────────────────────

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
const recomputeDisabled = computed(
  () =>
    props.recomputingAddedAt ||
    !props.storedAddedAtSource ||
    props.storedAddedAtSource === 'imported' ||
    props.addedAtSource !== props.storedAddedAtSource,
)
const showSaveFirstHint = computed(() => props.canRecomputeAddedAt && props.addedAtSource !== props.storedAddedAtSource)

function selectAddedAtSource(event: Event) {
  emit('update:addedAtSource', (event.target as HTMLInputElement).value as AddedAtSource)
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
</script>

<template>
  <div class="flex flex-col gap-3.5">
    <LibraryCreatorCard :label="t('library.creator.scanner.mode.title')" label-id="organization-mode-title">
      <template v-if="organizationModeLocked" #meta>
        <span class="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          <Lock :size="10" aria-hidden="true" />
          {{ t('library.creator.scanner.mode.locked') }}
        </span>
      </template>

      <div v-if="organizationModeLocked" class="flex flex-col gap-3 @md:flex-row @md:items-center">
        <LibraryOrganizationPreview :mode="organizationMode" class="w-full shrink-0 @md:w-44" />
        <div class="min-w-0">
          <p class="text-sm font-semibold text-foreground">{{ modeCopy[organizationMode].title }}</p>
          <p class="mt-0.5 text-xs text-muted-foreground">{{ modeCopy[organizationMode].hint }}</p>
          <p class="mt-1.5 text-xs text-muted-foreground">{{ t('library.creator.scanner.scanMode.lockTooltip') }}</p>
        </div>
      </div>

      <template v-else>
        <div role="radiogroup" aria-labelledby="organization-mode-title" class="grid gap-2.5">
          <label
            v-for="mode in ORGANIZATION_MODES"
            :key="mode"
            class="flex cursor-pointer flex-col gap-2.5 rounded-xl border p-3 transition-colors focus-within:ring-2 focus-within:ring-ring"
            :class="organizationMode === mode ? 'border-primary bg-primary/7 ring-1 ring-primary' : 'border-border bg-background hover:bg-muted'"
          >
            <span class="flex items-center gap-2">
              <input
                type="radio"
                name="organization-mode"
                :value="mode"
                :checked="organizationMode === mode"
                class="size-4 shrink-0 accent-primary"
                @change="selectMode"
              />
              <span class="text-sm font-semibold text-foreground">{{ modeCopy[mode].title }}</span>
              <span v-if="mode === 'book_per_folder'" class="ms-auto rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {{ t('library.creator.scanner.scanMode.recommended') }}
              </span>
            </span>
            <span class="flex flex-col gap-2.5 @md:flex-row @md:items-center">
              <LibraryOrganizationPreview :mode="mode" class="shrink-0 @md:w-44" />
              <span class="flex min-w-0 flex-col gap-1">
                <span class="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <ArrowRight :size="12" class="shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden="true" />
                  {{ modeCopy[mode].result }}
                </span>
                <span class="text-xs text-muted-foreground">{{ modeCopy[mode].hint }}</span>
              </span>
            </span>
          </label>
        </div>
        <p class="mt-2.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock :size="12" class="shrink-0" aria-hidden="true" />
          {{ t('library.creator.scanner.mode.cannotChange') }}
        </p>
      </template>
    </LibraryCreatorCard>

    <LibraryCreatorCard :label="t('library.creator.scanner.import.title')" label-id="import-formats-title">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div role="radiogroup" aria-labelledby="import-formats-title" class="inline-flex gap-0.5 rounded-lg border border-border bg-muted p-0.5">
          <label
            class="cursor-pointer rounded-md px-3 py-1 text-[13px] font-medium transition-colors focus-within:ring-2 focus-within:ring-ring"
            :class="importAll ? 'bg-background text-primary shadow-xs' : 'text-foreground hover:bg-background/60'"
          >
            <input type="radio" name="import-formats" class="sr-only" :checked="importAll" @change="selectImportAll" />
            {{ t('library.creator.scanner.import.all') }}
          </label>
          <label
            class="cursor-pointer rounded-md px-3 py-1 text-[13px] font-medium transition-colors focus-within:ring-2 focus-within:ring-ring"
            :class="!importAll ? 'bg-background text-primary shadow-xs' : 'text-foreground hover:bg-background/60'"
          >
            <input type="radio" name="import-formats" class="sr-only" :checked="!importAll" @change="selectImportSome" />
            {{ t('library.creator.scanner.import.some') }}
          </label>
        </div>
        <span class="text-xs text-muted-foreground">
          {{ importAll ? t('library.creator.scanner.allowedFormats.allAllowed') : t('library.creator.scanner.allowedFormats.onlySelected') }}
        </span>
      </div>

      <template v-if="!importAll">
        <div class="mt-3 grid gap-2 @lg:grid-cols-2">
          <div v-for="group in FORMAT_GROUPS" :key="group.id" class="rounded-lg border border-border bg-background px-3 py-2.5">
            <p :id="`format-group-${group.id}`" class="mb-2 flex items-center gap-2 text-xs font-semibold text-foreground">
              <span class="size-1.5 rounded-[2px]" :style="{ backgroundColor: formatFamilyColor(group.formats[0]!) }" aria-hidden="true" />
              {{ t(`library.creator.scanner.import.groups.${group.id}`) }}
            </p>
            <div role="group" :aria-labelledby="`format-group-${group.id}`" class="flex flex-wrap gap-1.5">
              <button
                v-for="format in group.formats"
                :key="format"
                type="button"
                class="rounded-md border px-2 py-0.5 text-[11px] font-semibold tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                :class="isImported(format) ? '' : 'border-border text-muted-foreground line-through hover:text-foreground'"
                :style="chipStyle(format)"
                :aria-pressed="isImported(format)"
                @click="toggleFormat(format)"
              >
                {{ format.toUpperCase() }}
              </button>
            </div>
          </div>
        </div>
        <p class="mt-2.5 flex items-start gap-1.5 text-xs text-warning">
          <TriangleAlert :size="13" class="mt-px shrink-0" aria-hidden="true" />
          <span>{{ t('library.creator.scanner.allowedFormats.warning') }}</span>
        </p>
      </template>
    </LibraryCreatorCard>

    <LibraryCreatorCard :label="t('library.creator.scanner.skip.title')">
      <template #meta>{{
        excludePatterns.length ? t('library.creator.scanner.skip.count', { count: excludePatterns.length }) : t('library.creator.optional')
      }}</template>
      <div class="flex flex-wrap items-center gap-1.5 rounded-lg border border-input bg-background p-1.5 focus-within:ring-2 focus-within:ring-ring">
        <span
          v-for="pattern in excludePatterns"
          :key="pattern"
          class="inline-flex items-center gap-1 rounded-md border border-border bg-card py-0.5 pe-1 ps-2 font-mono text-xs text-foreground"
          dir="ltr"
        >
          {{ pattern }}
          <button
            type="button"
            class="flex size-4.5 items-center justify-center rounded text-foreground hover:bg-muted hover:text-destructive"
            :aria-label="t('library.creator.scanner.skip.remove', { pattern })"
            @click="removePattern(pattern)"
          >
            <X :size="11" aria-hidden="true" />
          </button>
        </span>
        <label for="exclude-pattern-input" class="sr-only">{{ t('library.creator.scanner.skip.inputLabel') }}</label>
        <input
          id="exclude-pattern-input"
          v-model="newPattern"
          type="text"
          dir="ltr"
          class="h-7 min-w-40 flex-1 bg-transparent px-1.5 font-mono text-[12.5px] text-foreground placeholder:font-sans placeholder:text-muted-foreground focus:outline-none"
          :placeholder="excludePatterns.length ? t('library.creator.scanner.skip.placeholderMore') : t('library.creator.scanner.skip.placeholder')"
          aria-describedby="exclude-pattern-hint"
          @keydown="onPatternKeydown"
        />
        <button
          type="button"
          class="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
          :disabled="!newPattern.trim()"
          @click="addPattern"
        >
          <Plus :size="12" aria-hidden="true" />
          {{ t('library.creator.scanner.excludePatterns.add') }}
        </button>
      </div>
      <p id="exclude-pattern-hint" class="mt-1.5 text-xs text-muted-foreground">{{ t('library.creator.scanner.skip.hint') }}</p>
    </LibraryCreatorCard>

    <LibraryCreatorCard :label="t('library.creator.scanner.addedAt.title')" label-id="added-at-title">
      <div
        ref="sourceGroup"
        role="radiogroup"
        aria-labelledby="added-at-title"
        aria-describedby="added-at-hint"
        class="grid gap-0.5 rounded-lg border border-border bg-muted p-0.5 @lg:grid-cols-3"
      >
        <label
          v-for="source in ADDED_AT_SOURCES"
          :key="source"
          class="cursor-pointer rounded-md px-3 py-1.5 text-center text-[13px] font-medium transition-colors focus-within:ring-2 focus-within:ring-ring"
          :class="addedAtSource === source ? 'bg-background text-primary shadow-xs' : 'text-foreground hover:bg-background/60'"
        >
          <input
            type="radio"
            name="added-at-source"
            :value="source"
            :checked="addedAtSource === source"
            class="sr-only"
            @change="selectAddedAtSource"
          />
          {{ t(`library.creator.scanner.addedAt.options.${source}.title`) }}
        </label>
      </div>
      <p id="added-at-hint" class="mt-2 text-xs text-muted-foreground">{{ t(`library.creator.scanner.addedAt.options.${addedAtSource}.hint`) }}</p>
      <p class="mt-1 text-xs text-muted-foreground">{{ t('library.creator.scanner.addedAt.hint') }}</p>

      <div v-if="canRecomputeAddedAt" class="mt-3 flex flex-wrap items-center gap-3">
        <button
          ref="recomputeButton"
          type="button"
          class="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="recomputeDisabled"
          @click="requestRecompute"
        >
          <RefreshCw :size="13" :class="recomputingAddedAt ? 'motion-safe:animate-spin' : ''" aria-hidden="true" />
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
        class="mt-3 rounded-lg border border-border bg-background p-3"
      >
        <p class="text-sm text-muted-foreground">{{ t('library.creator.scanner.addedAt.backgroundConfirm') }}</p>
        <div class="mt-3 flex flex-wrap gap-2">
          <button
            ref="confirmButton"
            type="button"
            :disabled="recomputeDisabled"
            class="h-8 rounded-md border border-border px-3 text-[13px] font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            @click="confirmRecompute"
          >
            {{ t('library.creator.scanner.addedAt.recompute') }}
          </button>
          <button
            type="button"
            class="h-8 rounded-md px-3 text-[13px] font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
    </LibraryCreatorCard>
  </div>
</template>
