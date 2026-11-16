<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowUpRight, Check, FileText, Image, Minus, Paperclip, Tags, X } from '@lucide/vue'
import type { BookRequestReview, BookRequestReviewFile, BookRequestVerificationRow } from '@bookorbit/types'
import { formatLanguageName, formatList, formatNumber } from '@/i18n/formatters'
import { formatBytes } from '@/lib/formatting'
import RequestDrawerSection from './RequestDrawerSection.vue'

const props = defineProps<{
  review: BookRequestReview
  /** The cover found in the imported file, or null where it carried none. */
  coverUrl?: string | null
  /** Somebody who can file it, who is the one told when there is nowhere to file it to. */
  canManage: boolean
}>()

const { t } = useI18n()

const ROLE_ICONS = { content: FileText, cover: Image, metadata: Tags, supplement: Paperclip } as const

const VERDICT_ICONS = { match: Check, mismatch: X, unknown: Minus } as const

/** A match ticks in green and a mismatch reads in red, field name and imported value alike. */
const VERDICT_CLASSES = { match: 'text-success', mismatch: 'text-destructive', unknown: 'text-muted-foreground' } as const

const verification = computed(() => props.review.verification)
/** Both pointers to the dock entry are `on delete set null`, so a hand-filed one leaves nothing. */
const entryGone = computed(() => props.review.bookDockFileId === null)

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
  return props.review.totalSizeBytes === null ? [count] : [count, formatBytes(props.review.totalSizeBytes)]
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
</script>

<template>
  <RequestDrawerSection :title="t('bookRequests.review.checkTitle')">
    <!-- The source's own description of what was sent, to hold the file below up against. -->
    <template v-if="review.releaseInfoUrl" #aside>
      <a
        :href="review.releaseInfoUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex items-center gap-[3px] rounded-sm text-xs whitespace-nowrap text-foreground hover:underline hover:underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {{ t('bookRequests.review.releasePage') }}
        <ArrowUpRight :size="13" aria-hidden="true" />
      </a>
    </template>

    <template v-if="entryGone">
      <p class="text-[13px] text-foreground">{{ t('bookRequests.review.missingEntryNext') }}</p>
    </template>

    <template v-else>
      <p v-if="verification" class="mb-2.5 text-[13px] text-foreground">{{ t(`bookRequests.review.reason.${verification.reason}`) }}</p>

      <table v-if="verification" class="w-full table-fixed border-collapse text-[13px]">
        <thead>
          <tr>
            <th scope="col" class="w-[72px] pe-3 pb-2 text-start align-top text-[11px] font-medium text-muted-foreground @min-[30rem]:w-[84px]">
              <span class="sr-only">{{ t('bookRequests.review.fieldColumn') }}</span>
            </th>
            <th scope="col" class="pe-3 pb-2 text-start align-top text-[11px] font-medium text-muted-foreground">
              {{ t('bookRequests.review.requested') }}
            </th>
            <th scope="col" class="pe-3 pb-2 text-start align-top text-[11px] font-medium text-muted-foreground">
              {{ t('bookRequests.review.imported') }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in verification.rows" :key="row.field">
            <th scope="row" class="border-t border-border py-2 pe-3 text-start align-top font-normal">
              <span
                class="inline-flex items-center gap-1.5 font-medium whitespace-nowrap"
                :class="row.verdict === 'mismatch' ? 'text-destructive' : 'text-muted-foreground'"
              >
                <component :is="VERDICT_ICONS[row.verdict]" :size="13" :class="VERDICT_CLASSES[row.verdict]" aria-hidden="true" />
                {{ t(`bookRequests.review.field.${row.field}`) }}
              </span>
              <span class="sr-only">{{ t(`bookRequests.review.verdict.${row.verdict}`) }}</span>
            </th>
            <td v-if="isAbsent(row)" colspan="2" class="border-t border-border py-2 pe-3 align-top text-muted-foreground">
              {{ t('bookRequests.review.absent') }}
            </td>
            <template v-else>
              <td
                class="border-t border-border py-2 pe-3 align-top [overflow-wrap:anywhere]"
                :class="row.requested === null ? 'text-muted-foreground' : 'text-foreground'"
              >
                {{ row.requested ?? t('bookRequests.review.notSet') }}
              </td>
              <td
                class="border-t border-border py-2 pe-3 align-top [overflow-wrap:anywhere]"
                :class="row.imported === null ? 'text-muted-foreground' : row.verdict === 'mismatch' ? 'text-destructive' : 'text-foreground'"
              >
                {{ row.imported ?? t('bookRequests.review.notSet') }}
              </td>
            </template>
          </tr>
        </tbody>
      </table>

      <div :class="verification ? 'mt-4' : ''">
        <p class="mb-1.5 text-xs font-semibold text-foreground">
          {{ t('bookRequests.review.filesTitle') }}
          <template v-for="(part, index) in filesSummary" :key="index">
            <span class="font-normal text-muted-foreground" aria-hidden="true"> · </span>
            <span class="font-normal text-muted-foreground tabular-nums">{{ part }}</span>
          </template>
        </p>
        <ul class="grid gap-1.5">
          <li v-for="file in review.files" :key="file.fileName" class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 text-xs">
            <component :is="ROLE_ICONS[file.role]" :size="14" class="mt-px text-muted-foreground" aria-hidden="true" />
            <span class="[overflow-wrap:anywhere] text-foreground">{{ file.fileName }}</span>
            <span class="text-muted-foreground tabular-nums">{{ fileDetail(file) }}</span>
          </li>
        </ul>

        <template v-if="editionRows.length || showCover">
          <p class="mt-3.5 mb-1.5 text-xs font-semibold text-foreground">{{ t('bookRequests.review.editionTitle') }}</p>
          <div class="flex items-start gap-3">
            <img
              v-if="showCover"
              :src="coverUrl ?? undefined"
              :alt="t('bookRequests.review.importedCover')"
              class="h-[60px] w-10 shrink-0 rounded-xs border border-border object-cover"
              @error="handleCoverError"
            />
            <dl v-if="editionRows.length" class="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-2 @min-[30rem]:grid-cols-4">
              <div v-for="row in editionRows" :key="row.key" class="min-w-0">
                <dt class="text-xs text-muted-foreground">{{ row.label }}</dt>
                <dd class="mt-0.5 text-[13px] [overflow-wrap:anywhere] text-foreground tabular-nums">{{ row.value }}</dd>
              </div>
            </dl>
          </div>
        </template>
      </div>

      <p v-if="canManage && !review.canFile" class="mt-3 text-[13px] text-muted-foreground">{{ t('bookRequests.review.noDestination') }}</p>
    </template>
  </RequestDrawerSection>
</template>
