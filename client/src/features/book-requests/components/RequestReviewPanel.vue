<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, ExternalLink, FileText, Image, Loader2, Minus, Paperclip, Tags, Trash2, X } from '@lucide/vue'
import type { BookRequestReview, BookRequestReviewFile, BookRequestVerificationRow } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { formatLanguageName, formatList, formatNumber } from '@/i18n/formatters'
import { formatBytes } from '@/lib/formatting'

const props = defineProps<{
  review: BookRequestReview
  /** The cover found in the imported file, or null where it carried none. */
  coverUrl?: string | null
  canManage: boolean
  busy: boolean
}>()

const emit = defineEmits<{ file: []; discard: [] }>()

const { t } = useI18n()

const ROLE_ICONS = { content: FileText, cover: Image, metadata: Tags, supplement: Paperclip } as const

const VERDICT_ICONS = { match: Check, mismatch: X, unknown: Minus } as const

/** Only the mismatch is coloured. A tick in green beside every matching field is just noise. */
const VERDICT_CLASSES = { match: 'text-muted-foreground', mismatch: 'text-destructive', unknown: 'text-muted-foreground' } as const

const verification = computed(() => props.review.verification)
/** Both pointers to the dock entry are `on delete set null`, so a hand-filed one leaves nothing. */
const entryGone = computed(() => props.review.bookDockFileId === null)

const headline = computed(() => {
  const detail = verification.value
  if (!detail) return t('bookRequests.review.verificationOff')
  return detail.passed
    ? t('bookRequests.review.scoreClears', { score: detail.score, threshold: detail.threshold })
    : t('bookRequests.review.scoreShort', { score: detail.score, threshold: detail.threshold })
})

/**
 * "File it anyway" is an override, which is the wrong word for an import that passed and is only
 * waiting because whoever sent it asked to look first.
 */
const fileIsOverride = computed(() => !props.review.heldOnRequest || verification.value?.passed === false)

interface EditionRow {
  key: string
  label: string
  value: string
}

/** Only what the file states. A row of "Not set" for every fact an ebook never carries is noise. */
const editionRows = computed<EditionRow[]>(() => {
  const edition = props.review.edition
  if (!edition) return []
  const rows: EditionRow[] = []
  const add = (key: string, value: string | null) => {
    if (value) rows.push({ key, label: t(`bookRequests.review.edition.${key}`), value })
  }
  add('publisher', edition.publisher)
  add('published', edition.publishedDate)
  add('language', edition.language ? formatLanguageName(edition.language) : null)
  add('pages', edition.pageCount !== null ? formatNumber(edition.pageCount) : null)
  add('isbn10', edition.isbn10)
  add('narrators', edition.narrators.length ? formatList(edition.narrators) : null)
  add('length', edition.durationSeconds !== null ? formatDuration(edition.durationSeconds) : null)
  add('version', edition.abridged === null ? null : t(edition.abridged ? 'bookRequests.review.abridged' : 'bookRequests.review.unabridged'))
  add('chapters', edition.chapterCount !== null ? formatNumber(edition.chapterCount) : null)
  return rows
})

/** A cover the server listed can still fail to load; the facts beside it stand on their own. */
const coverFailed = ref(false)
watch(
  () => props.coverUrl,
  () => {
    coverFailed.value = false
  },
)
const showCover = computed(() => Boolean(props.coverUrl) && !coverFailed.value)

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  return hours > 0 ? t('bookRequests.releases.durationHm', { hours, minutes }) : t('bookRequests.releases.durationM', { minutes })
}

function handleCoverError() {
  coverFailed.value = true
}

const filesSummary = computed(() => {
  const count = t('bookRequests.review.fileCount', { count: props.review.files.length })
  return props.review.totalSizeBytes === null ? count : `${count} · ${formatBytes(props.review.totalSizeBytes)}`
})

/** Both sides empty says more as one line than as two rows of "Not set". */
function isAbsent(row: BookRequestVerificationRow): boolean {
  return row.requested === null && row.imported === null
}

function fileDetail(file: BookRequestReviewFile): string {
  const parts: string[] = []
  if (file.format) parts.push(file.format.toUpperCase())
  if (file.fileSize !== null) parts.push(formatBytes(file.fileSize))
  if (file.role !== 'content') parts.push(t(`bookRequests.review.role.${file.role}`))
  return parts.join(' · ')
}

function handleFile() {
  emit('file')
}

function handleDiscard() {
  emit('discard')
}
</script>

<template>
  <section class="rounded-lg border border-border bg-card p-4" :aria-label="t('bookRequests.review.title')">
    <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{{ t('bookRequests.review.title') }}</h3>
      <!-- The source's own description of what was sent, to hold the file below up against. -->
      <a
        v-if="props.review.releaseInfoUrl"
        :href="props.review.releaseInfoUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex items-center gap-1 rounded-sm text-xs text-foreground hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span class="underline underline-offset-2">{{ t('bookRequests.review.releasePage') }}</span>
        <ExternalLink :size="12" class="shrink-0" aria-hidden="true" />
      </a>
    </div>

    <template v-if="entryGone">
      <p class="mt-2 text-sm text-foreground">{{ t('bookRequests.review.missingEntry') }}</p>
      <p class="mt-1 text-sm text-muted-foreground">{{ t('bookRequests.review.missingEntryNext') }}</p>
    </template>

    <template v-else>
      <p v-if="props.review.heldOnRequest" class="mt-2 text-sm text-foreground">{{ t('bookRequests.review.heldOnRequest') }}</p>
      <p class="text-sm" :class="props.review.heldOnRequest ? 'mt-1 text-muted-foreground' : 'mt-2 text-foreground'">{{ headline }}</p>
      <p v-if="verification" class="mt-1 text-sm text-muted-foreground">{{ t(`bookRequests.review.reason.${verification.reason}`) }}</p>

      <dl v-if="verification" class="mt-4 grid gap-3">
        <div v-for="row in verification.rows" :key="row.field" class="grid gap-1 border-t border-border pt-3 first:border-t-0 first:pt-0">
          <dt class="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            <component :is="VERDICT_ICONS[row.verdict]" :size="13" :class="VERDICT_CLASSES[row.verdict]" aria-hidden="true" />
            {{ t(`bookRequests.review.field.${row.field}`) }}
            <span class="sr-only">{{ t(`bookRequests.review.verdict.${row.verdict}`) }}</span>
          </dt>

          <dd v-if="isAbsent(row)" class="text-sm text-muted-foreground">{{ t('bookRequests.review.absent') }}</dd>
          <dd v-else class="grid gap-1 @md:grid-cols-2">
            <span class="grid gap-0.5">
              <span class="text-xs text-muted-foreground">{{ t('bookRequests.review.requested') }}</span>
              <span class="break-words text-sm text-foreground">{{ row.requested ?? t('bookRequests.review.notSet') }}</span>
            </span>
            <span class="grid gap-0.5">
              <span class="text-xs text-muted-foreground">{{ t('bookRequests.review.imported') }}</span>
              <span class="break-words text-sm" :class="row.verdict === 'mismatch' ? 'text-destructive' : 'text-foreground'">
                {{ row.imported ?? t('bookRequests.review.notSet') }}
              </span>
            </span>
          </dd>
        </div>
      </dl>

      <template v-if="editionRows.length || showCover">
        <h4 class="mt-4 border-t border-border pt-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {{ t('bookRequests.review.editionTitle') }}
        </h4>
        <div class="mt-2 flex items-start gap-3">
          <img
            v-if="showCover"
            :src="props.coverUrl ?? undefined"
            :alt="t('bookRequests.review.importedCover')"
            class="h-[90px] w-[60px] shrink-0 rounded-sm border border-border object-cover"
            @error="handleCoverError"
          />
          <dl v-if="editionRows.length" class="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1">
            <template v-for="row in editionRows" :key="row.key">
              <dt class="text-xs text-muted-foreground">{{ row.label }}</dt>
              <dd class="break-words text-sm text-foreground">{{ row.value }}</dd>
            </template>
          </dl>
        </div>
      </template>

      <h4 class="mt-4 border-t border-border pt-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {{ t('bookRequests.review.filesTitle') }}
      </h4>
      <p class="mt-1 text-xs text-muted-foreground">{{ filesSummary }}</p>

      <ul class="mt-2 grid gap-1">
        <li v-for="file in props.review.files" :key="file.fileName" class="flex items-start gap-2 rounded-md border border-border p-2">
          <component :is="ROLE_ICONS[file.role]" :size="15" class="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span class="min-w-0 flex-1">
            <span class="block break-all text-sm text-foreground">{{ file.fileName }}</span>
            <span v-if="fileDetail(file)" class="block text-xs text-muted-foreground">{{ fileDetail(file) }}</span>
          </span>
        </li>
      </ul>

      <template v-if="props.canManage">
        <p v-if="!props.review.canFile" class="mt-3 text-sm text-muted-foreground">{{ t('bookRequests.review.noDestination') }}</p>
        <div class="mt-3 flex flex-wrap items-center gap-3">
          <Button :disabled="!props.review.canFile || props.busy" @click="handleFile">
            <Loader2 v-if="props.busy" class="size-4 animate-spin" aria-hidden="true" />
            {{ fileIsOverride ? t('bookRequests.review.fileAnyway') : t('bookRequests.review.fileIt') }}
          </Button>
          <!--
            The other answer, beside the first rather than behind a menu: a held import is a
            question with exactly two answers, and until this existed the only way to say "wrong
            book" was to cancel the request and leave the dock entry behind as an orphan.
          -->
          <Button variant="destructive-outline" :disabled="props.busy" @click="handleDiscard">
            <Trash2 :size="15" aria-hidden="true" />
            {{ t('bookRequests.review.discard') }}
          </Button>
          <RouterLink
            :to="{ name: 'book-dock' }"
            class="rounded-sm text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {{ t('bookRequests.review.openDock') }}
          </RouterLink>
        </div>
        <p class="mt-2 text-xs text-muted-foreground">
          {{ fileIsOverride ? t('bookRequests.review.fileAnywayHint') : t('bookRequests.review.fileItHint') }}
        </p>
        <p class="mt-1 text-xs text-muted-foreground">{{ t('bookRequests.review.discardHint') }}</p>
      </template>
    </template>
  </section>
</template>
