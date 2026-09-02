<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, FileText, Image, Loader2, Minus, Paperclip, Tags, Trash2, X } from '@lucide/vue'
import type { BookRequestReview, BookRequestReviewFile, BookRequestVerificationRow } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { formatBytes } from '@/lib/formatting'

const props = defineProps<{
  review: BookRequestReview
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
    <h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{{ t('bookRequests.review.title') }}</h3>

    <template v-if="entryGone">
      <p class="mt-2 text-sm text-foreground">{{ t('bookRequests.review.missingEntry') }}</p>
      <p class="mt-1 text-sm text-muted-foreground">{{ t('bookRequests.review.missingEntryNext') }}</p>
    </template>

    <template v-else>
      <p class="mt-2 text-sm text-foreground">{{ headline }}</p>
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
            {{ t('bookRequests.review.fileAnyway') }}
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
        <p class="mt-2 text-xs text-muted-foreground">{{ t('bookRequests.review.fileAnywayHint') }}</p>
        <p class="mt-1 text-xs text-muted-foreground">{{ t('bookRequests.review.discardHint') }}</p>
      </template>
    </template>
  </section>
</template>
