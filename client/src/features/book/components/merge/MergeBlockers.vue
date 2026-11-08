<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { OctagonX } from '@lucide/vue'
import { BOOK_MERGE_MAX_BOOKS, type BookMergeBlocker, type BookMergePreviewResponse } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { formatBytes } from '@/lib/formatting'
import { blockerAlternative, destinationAvoidsBlocker, mergeDestinationLibraryId } from '@/features/book/lib/book-merge'

const props = withDefaults(
  defineProps<{
    blockers: BookMergeBlocker[]
    bookLabels: Map<number, string>
    libraryNames?: Map<number, string>
    /** The preview the blockers came from, to tell whether another destination would avoid one. */
    preview?: BookMergePreviewResponse | null
    /** The host can open Link for these books, so a blocker that suggests it offers the button. */
    canLink?: boolean
    /** The host shows "Where the merged book lives", so a blocker another destination avoids points there. */
    canChooseDestination?: boolean
  }>(),
  { libraryNames: () => new Map(), preview: null, canLink: false, canChooseDestination: false },
)

const emit = defineEmits<{ 'choose-keeper': []; 'choose-destination': []; 'link-instead': [] }>()

const { t, te } = useI18n()

function libraryName(libraryId: number | undefined): string {
  const id = libraryId ?? (props.preview ? mergeDestinationLibraryId(props.preview) : null)
  return (id != null ? props.libraryNames.get(id) : undefined) ?? t('book.merge.crossLibrary.unknownLibrary')
}

function blockerText(blocker: BookMergeBlocker): string {
  const key = `book.merge.blockers.${blocker.code}`
  if (!te(key)) return t('book.merge.blockers.unknown')
  switch (blocker.code) {
    case 'TOO_MANY_BOOKS':
      return t(key, { max: BOOK_MERGE_MAX_BOOKS })
    case 'INSUFFICIENT_SPACE':
      return blocker.bytes != null ? t(key, { size: formatBytes(blocker.bytes) }) : t('book.merge.crossLibrary.blockers.insufficientSpace')
    case 'LIBRARY_BUSY':
      return blocker.libraryId != null ? t('book.merge.crossLibrary.blockers.libraryBusy', { library: libraryName(blocker.libraryId) }) : t(key)
    case 'FORMAT_NOT_ALLOWED':
      return t(key, { library: libraryName(blocker.libraryId), format: (blocker.format ?? '').toUpperCase() })
    case 'PATH_EXCLUDED':
    case 'LEFTOVER_CONTENT':
      return t(key, { library: libraryName(blocker.libraryId) })
    default:
      return t(key)
  }
}

/** What holds a busy book; an unknown reason from a newer server shows nothing extra. */
function busyText(blocker: BookMergeBlocker): string | null {
  if (blocker.code !== 'BOOK_BUSY' || !blocker.busyReason) return null
  const key = `book.merge.busyReasons.${blocker.busyReason}`
  return te(key) ? t(key) : null
}

const items = computed(() =>
  props.blockers.map((blocker, index) => ({
    key: `${blocker.code}-${blocker.bookId ?? 'all'}-${index}`,
    code: blocker.code,
    text: blockerText(blocker),
    book: blocker.bookId != null ? (props.bookLabels.get(blocker.bookId) ?? null) : null,
    detail: busyText(blocker),
    path: blocker.relPath ?? null,
    alternative: blockerAlternative(blocker.code),
    otherDestination: props.canChooseDestination && props.preview !== null && destinationAvoidsBlocker(blocker, props.preview),
  })),
)

function chooseKeeper(): void {
  emit('choose-keeper')
}

function chooseDestination(): void {
  emit('choose-destination')
}

function linkInstead(): void {
  emit('link-instead')
}
</script>

<template>
  <div class="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5" role="alert" data-testid="merge-blockers">
    <p class="flex items-center gap-2 text-sm font-semibold text-destructive">
      <OctagonX :size="15" class="shrink-0" aria-hidden="true" />
      {{ t('book.merge.blocked.heading') }}
    </p>
    <ul class="space-y-2">
      <li v-for="item in items" :key="item.key" class="text-sm text-foreground" :data-code="item.code" data-testid="merge-blocker">
        <span class="block">{{ item.text }}</span>
        <span v-if="item.book" class="block text-xs text-muted-foreground">{{ item.book }}</span>
        <span v-if="item.detail" class="block text-xs text-muted-foreground" data-testid="merge-blocker-detail">{{ item.detail }}</span>
        <span v-if="item.path" class="block font-mono text-[0.7rem] break-all text-muted-foreground" dir="auto">{{ item.path }}</span>
        <span
          v-if="item.alternative === 'chooseKeeper' || item.otherDestination || (item.alternative === 'link' && canLink)"
          class="mt-1.5 flex flex-wrap gap-2"
        >
          <Button v-if="item.alternative === 'chooseKeeper'" size="sm" variant="outline" @click="chooseKeeper">
            {{ t('book.merge.blocked.chooseKeeper') }}
          </Button>
          <Button v-if="item.otherDestination" size="sm" variant="outline" data-testid="merge-choose-destination" @click="chooseDestination">
            {{ t('book.merge.crossLibrary.blocked.chooseDestination') }}
          </Button>
          <Button v-if="item.alternative === 'link' && canLink" size="sm" variant="outline" data-testid="merge-link-instead" @click="linkInstead">
            {{ t('book.merge.blocked.linkInstead') }}
          </Button>
        </span>
      </li>
    </ul>
  </div>
</template>
