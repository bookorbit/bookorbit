<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { BookOpen, Check, ChevronDown, ClipboardCopy, Eye } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { OrganizationMode } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { copyToClipboard } from '@/lib/clipboard'
import ResolvedPathTree from './ResolvedPathTree.vue'
import LevelChangeList, { type ChangeRow } from './LevelChangeList.vue'
import { levelChanges, resolvePreview, type ResolveOptions } from '../lib/pattern-resolution'
import { MISSING_METADATA_CASES, PREVIEW_CASES, type PreviewCaseId } from '../lib/pattern-preview'
import { PREVIEW_BOOK_IDS, PREVIEW_BOOK_NOTE_KEYS, PREVIEW_BOOKS, withoutFields, type PreviewBookId } from '../lib/preview-books'
import type { NamingTarget } from '../lib/naming-rules'

const props = defineProps<{
  pattern: string
  target: NamingTarget
  mode: OrganizationMode | null
  sanitize: boolean
  previewBookId: PreviewBookId
  caseId: PreviewCaseId
  /** Set while the pattern is invalid: the preview shows what it last resolved to, dimmed. */
  stale?: boolean
}>()

const emit = defineEmits<{ 'update:previewBookId': [value: PreviewBookId]; 'update:caseId': [value: PreviewCaseId] }>()

const { t } = useI18n()

const CASE_LABELS: Record<PreviewCaseId, string> = {
  complete: 'settings.reader.fileNaming.exampleCase.complete',
  noSeries: 'settings.reader.fileNaming.caseNoSeriesLabel',
  noYear: 'settings.reader.fileNaming.caseNoYearLabel',
  noAuthor: 'settings.reader.fileNaming.caseNoAuthorLabel',
}

const book = computed(() => PREVIEW_BOOKS[props.previewBookId])
const options = computed<ResolveOptions>(() => ({
  target: props.target,
  mode: props.mode,
  extension: book.value.extension,
  sanitize: props.sanitize,
}))
const isUpload = computed(() => props.target === 'upload')

function resolveFor(omit: readonly string[]) {
  return resolvePreview(props.pattern, withoutFields(book.value.metadata, omit), options.value)
}

const complete = computed(() => resolveFor([]))
const activeCase = computed(() => PREVIEW_CASES.find((entry) => entry.id === props.caseId) ?? PREVIEW_CASES[0]!)
const shown = computed(() => (props.caseId === 'complete' ? complete.value : resolveFor(activeCase.value.omit)))

const missingRows = computed<ChangeRow[]>(() =>
  MISSING_METADATA_CASES.map((entry) => ({
    id: entry.id,
    label: t(CASE_LABELS[entry.id]),
    changes: levelChanges(complete.value, resolveFor(entry.omit)),
  })),
)

/** Only a book that is a read-aloud EPUB has a plain counterpart worth comparing against. */
const showsReadaloud = computed(() => props.pattern.includes('{readaloud') && !!book.value.metadata.readaloud)
const readaloudRows = computed<ChangeRow[]>(() => [
  { id: 'plain', label: t('settings.reader.fileNaming.plainEpub'), changes: levelChanges(complete.value, resolveFor(['readaloud'])) },
])

const bookNote = (id: PreviewBookId) => t(PREVIEW_BOOK_NOTE_KEYS[id])

function chooseBook(id: PreviewBookId) {
  emit('update:previewBookId', id)
}

/** Choosing the case already shown goes back to the complete book. */
function chooseCase(id: string) {
  emit('update:caseId', id === props.caseId ? 'complete' : (id as PreviewCaseId))
}

function showComplete() {
  emit('update:caseId', 'complete')
}

async function handleCopy() {
  if (!shown.value.path) return
  const copied = await copyToClipboard(shown.value.path)
  if (copied) toast.success(t('settings.reader.fileNaming.resultCopied'))
  else toast.error(t('settings.reader.fileNaming.resultCopyFailed'))
}
</script>

<template>
  <section :aria-label="t('settings.reader.fileNaming.resultPanel')">
    <p v-if="stale" class="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
      <Eye :size="13" class="shrink-0" aria-hidden="true" />
      {{ t('settings.reader.fileNaming.previewStale') }}
    </p>

    <div class="grid gap-5 @4xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]" :class="stale ? 'pointer-events-none opacity-45' : ''">
      <div class="min-w-0">
        <div class="mb-2 flex min-h-8 flex-wrap items-center gap-2">
          <h3 class="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{{ t('settings.reader.fileNaming.result') }}</h3>
          <span class="grow" />
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button
                variant="outline"
                size="sm"
                type="button"
                class="h-7 max-w-60 gap-1.5 px-2 text-xs"
                :aria-label="t('settings.reader.fileNaming.previewWithAria', { title: book.metadata.title })"
              >
                <BookOpen :size="13" class="shrink-0" aria-hidden="true" />
                <span class="truncate">{{ book.metadata.title }}</span>
                <ChevronDown :size="13" class="shrink-0 text-muted-foreground" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-72 max-w-[calc(100vw-2rem)]">
              <DropdownMenuLabel class="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{{
                t('settings.reader.fileNaming.previewWith')
              }}</DropdownMenuLabel>
              <DropdownMenuItem v-for="id in PREVIEW_BOOK_IDS" :key="id" class="items-start gap-2.5" @select="chooseBook(id)">
                <Check :size="14" class="mt-0.5" :class="id === previewBookId ? 'text-primary' : 'invisible'" aria-hidden="true" />
                <span class="min-w-0">
                  <span class="block truncate text-[13px]">{{ PREVIEW_BOOKS[id].metadata.title }}</span>
                  <span class="block text-xs text-muted-foreground">{{ bookNote(id) }}</span>
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="ghost"
                size="icon-sm"
                type="button"
                class="size-7"
                :disabled="!shown.path"
                :aria-label="t('settings.reader.fileNaming.copyResult')"
                @click="handleCopy"
              >
                <ClipboardCopy :size="14" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{{ t('settings.reader.fileNaming.copyResult') }}</TooltipContent>
          </Tooltip>
        </div>

        <div class="rounded-md border border-border bg-background/40 px-3.5 py-2.5">
          <p v-if="caseId !== 'complete'" class="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-primary">
            <Eye :size="13" class="shrink-0" aria-hidden="true" />
            {{ t('settings.reader.fileNaming.previewingCase', { case: t(CASE_LABELS[caseId]) }) }}
            <button type="button" class="ms-auto font-medium text-foreground underline underline-offset-2 hover:text-primary" @click="showComplete">
              {{ t('settings.reader.fileNaming.showComplete') }}
            </button>
          </p>
          <ResolvedPathTree :preview="shown" :extension="book.extension" :label="t(CASE_LABELS[caseId])" />
        </div>
      </div>

      <div v-if="isUpload" class="min-w-0 space-y-4">
        <div>
          <h3 class="mb-2 flex min-h-8 items-center text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            {{ t('settings.reader.fileNaming.missingMetadata') }}
          </h3>
          <LevelChangeList :rows="missingRows" :extension="book.extension" selectable :selected-id="caseId" @select="chooseCase" />
        </div>
        <div v-if="showsReadaloud">
          <h3 class="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            {{ t('settings.reader.fileNaming.readaloudComparison') }}
          </h3>
          <LevelChangeList :rows="readaloudRows" :extension="book.extension" />
        </div>
      </div>
    </div>
  </section>
</template>
