<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, Loader2, Pencil, X } from '@lucide/vue'
import { breakpointsTailwind, useBreakpoints } from '@vueuse/core'
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import type { BookCard } from '@bookorbit/types'
import { COVER_ASPECT_RATIO_KEY, DEFAULT_COVER_ASPECT_RATIO } from '../../lib/cover-aspect-ratio'
import { useBookDetail } from '../../composables/useBookDetail'
import { useMetadataLocks } from '../../composables/useMetadataLocks'
import { useCoverVersions } from '../../composables/useCoverVersions'
import BookCoverPlaceholder from '../BookCoverPlaceholder.vue'
import CoverEditorPanel from '../detail/tabs/CoverEditorPanel.vue'

const props = defineProps<{
  book: BookCard | null
  readOnly: boolean
}>()

const emit = defineEmits<{
  close: []
  'update:book': [bookId: number, hasCover: boolean]
}>()

const { t } = useI18n()
const { md } = useBreakpoints(breakpointsTailwind)
const isEditEnabled = computed(() => !props.readOnly && md.value)

const mode = ref<'view' | 'edit'>('view')
const savedCover = ref(false)

const { detail, loading, fetch } = useBookDetail()
const { isLocked, toggle, load: loadLocks } = useMetadataLocks()
const { coverUrl } = useCoverVersions()
const coverAspectRatio = inject(COVER_ASPECT_RATIO_KEY, ref(DEFAULT_COVER_ASPECT_RATIO))

const hasCoverResolved = computed(() => savedCover.value || (props.book?.hasCover ?? false))
const coverVersion = computed(() => detail.value?.updatedAt ?? props.book?.updatedAt ?? props.book?.addedAt ?? null)

watch(
  () => props.book?.id,
  () => {
    mode.value = 'view'
    savedCover.value = false
    detail.value = null
  },
)

watch(detail, (d) => {
  if (d) loadLocks(d)
})

function switchToEdit() {
  mode.value = 'edit'
  if (!detail.value || detail.value.id !== props.book?.id) {
    fetch(props.book!.id)
  }
}

function switchToView() {
  mode.value = 'view'
}

function handleCoverChanged() {
  savedCover.value = true
  if (props.book) emit('update:book', props.book.id, true)
  mode.value = 'view'
}

function handleOpenChange(open: boolean) {
  if (!open) emit('close')
}

async function handleToggleCoverLock() {
  if (!detail.value) return
  await toggle(detail.value.id, 'cover')
}
</script>

<template>
  <DialogRoot :open="book !== null" @update:open="handleOpenChange">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
      <DialogContent
        class="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card shadow-xl outline-none"
        @escape-key-down="handleOpenChange(false)"
      >
        <DialogDescription class="sr-only">
          {{ mode === 'view' ? t('book.table.cover.previewDescription') : t('book.table.cover.editDescription') }}
        </DialogDescription>

        <!-- Header -->
        <div class="flex items-center justify-between border-b border-border px-4 py-3">
          <div class="flex min-w-0 items-center gap-2">
            <button
              v-if="mode === 'edit'"
              class="flex shrink-0 items-center justify-center size-7 rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              @click="switchToView"
            >
              <ArrowLeft :size="15" />
            </button>
            <DialogTitle class="truncate text-sm font-semibold text-foreground">
              {{ mode === 'view' ? book?.title : t('book.table.cover.editTitle') }}
            </DialogTitle>
          </div>
          <DialogClose
            class="flex shrink-0 items-center justify-center size-7 rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X :size="15" />
          </DialogClose>
        </div>

        <!-- Body -->
        <div class="p-4">
          <!-- View mode -->
          <template v-if="mode === 'view'">
            <div class="mb-4 flex justify-center">
              <div class="overflow-hidden rounded-lg bg-muted shadow-md" :style="{ aspectRatio: coverAspectRatio, width: 'min(100%, 280px)' }">
                <img
                  v-if="hasCoverResolved && book"
                  :src="coverUrl(book.id, 'cover', coverVersion)"
                  :alt="book.title ?? ''"
                  class="h-full w-full object-contain"
                />
                <BookCoverPlaceholder
                  v-else
                  :title="book?.title ?? ''"
                  :author-line="null"
                  :is-audio="false"
                  :seed="String(book?.id ?? '')"
                  class="h-full w-full"
                />
              </div>
            </div>
            <button
              v-if="isEditEnabled"
              class="flex w-full items-center justify-center gap-2 h-9 rounded-lg border border-input bg-background text-sm font-medium transition-colors hover:bg-muted"
              @click="switchToEdit"
            >
              <Pencil :size="14" />
              {{ t('book.table.cover.editCover') }}
            </button>
          </template>

          <!-- Edit mode -->
          <template v-else>
            <div v-if="loading" class="flex items-center justify-center py-12">
              <Loader2 class="size-5 animate-spin text-muted-foreground" />
            </div>
            <CoverEditorPanel
              v-else-if="detail"
              :book="detail"
              :locked="isLocked('cover')"
              @cover-changed="handleCoverChanged"
              @toggle-lock="handleToggleCoverLock"
            />
          </template>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
