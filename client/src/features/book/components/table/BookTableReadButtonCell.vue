<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { BookOpen, ChevronDown, Eye, Play } from '@lucide/vue'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { isAudioFormat, READER_OPENABLE_FORMATS } from '@bookorbit/types'
import type { BookCard, BookFileRef } from '@bookorbit/types'
import BookFormatChip from '@/features/book/components/BookFormatChip.vue'
import { bookFormatEntries, fileFormatKey, formatKeyName } from '@/features/book/lib/book-formats'

const props = defineProps<{
  book: BookCard
}>()

const router = useRouter()
const { t } = useI18n()

const entries = computed(() => bookFormatEntries(props.book.files))
const isMultiTrackAudio = computed(() => entries.value.some((entry) => entry.audio && entry.files.length > 1))

/** One file per edition the reader can open; an audiobook opens from its first track. */
const openableFiles = computed<BookFileRef[]>(() =>
  entries.value.map((entry) => entry.files[0]!).filter((file) => READER_OPENABLE_FORMATS.has(file.format!.toLowerCase())),
)

const primaryFile = computed(() => openableFiles.value.find((file) => file.role === 'primary') ?? openableFiles.value[0] ?? null)

const canOpen = computed(() => props.book.status !== 'missing' && !!primaryFile.value)
const hasMultipleFormats = computed(() => openableFiles.value.length > 1)

function isAudioFile(file: BookFileRef | null): boolean {
  return file?.format != null && isAudioFormat(file.format)
}

function formatLabel(file: BookFileRef | null): string {
  const key = file ? fileFormatKey(file) : null
  return key ? formatKeyName(key) : t('book.table.read.fileFallback')
}

function actionLabel(file: BookFileRef | null): string {
  const format = formatLabel(file)
  return isAudioFile(file) ? t('book.table.read.playFormat', { format }) : t('book.table.read.readFormat', { format })
}

function openFile(file: BookFileRef | null, mode?: 'peek') {
  if (!file || props.book.status === 'missing') return
  router.push({
    name: 'reader',
    params: { bookId: props.book.id, fileId: file.id },
    query: mode === 'peek' ? { format: file.format ?? 'epub', mode } : { format: file.format ?? 'epub' },
  })
}

function openPrimaryFile() {
  openFile(primaryFile.value)
}

function peekPrimaryFile() {
  openFile(primaryFile.value, 'peek')
}
</script>

<template>
  <div v-if="canOpen" class="flex w-full items-center justify-start">
    <div v-if="hasMultipleFormats" class="mr-auto flex h-7 items-center overflow-hidden rounded-md">
      <button
        type="button"
        class="inline-flex h-7 w-7 items-center justify-center rounded-l-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        :aria-label="actionLabel(primaryFile)"
        :title="actionLabel(primaryFile)"
        @click.stop="openPrimaryFile"
      >
        <Play v-if="isAudioFile(primaryFile)" :size="13" class="text-sky-500" />
        <BookOpen v-else :size="13" class="text-emerald-500" />
      </button>
      <div class="w-px shrink-0 bg-border/80" />
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <button
            type="button"
            class="inline-flex h-7 w-6 shrink-0 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            :aria-label="t('book.table.read.chooseFormat')"
            @click.stop
          >
            <ChevronDown :size="12" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-48">
          <DropdownMenuItem v-for="file in openableFiles" :key="file.id" class="gap-2" @select="openFile(file)">
            <BookFormatChip :format-key="fileFormatKey(file) ?? '?'" class="rounded px-1.5 py-0.5 text-[10px] tracking-wide" />
            <span class="flex-1 truncate text-xs">{{ actionLabel(file) }}</span>
            <span v-if="file.role === 'primary' && !isMultiTrackAudio" class="text-[10px] text-primary">{{ t('book.table.read.primary') }}</span>
          </DropdownMenuItem>
          <DropdownMenuItem v-for="file in openableFiles" :key="`peek-${file.id}`" class="gap-2" @select="openFile(file, 'peek')">
            <Eye :size="13" class="text-primary" />
            <span class="flex-1 truncate text-xs">{{ t('book.table.read.peekFormat', { format: formatLabel(file) }) }}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <div v-else class="mr-auto inline-flex h-7 items-center overflow-hidden rounded-md">
      <button
        type="button"
        class="inline-flex h-7 w-7 items-center justify-center rounded-l-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        :aria-label="actionLabel(primaryFile)"
        :title="actionLabel(primaryFile)"
        @click.stop="openPrimaryFile"
      >
        <Play v-if="isAudioFile(primaryFile)" :size="13" class="text-sky-500" />
        <BookOpen v-else :size="13" class="text-emerald-500" />
      </button>
      <div class="w-px shrink-0 bg-border/80" />
      <button
        type="button"
        class="inline-flex h-7 w-7 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        :aria-label="t('book.table.read.peekFormat', { format: formatLabel(primaryFile) })"
        :title="t('book.table.read.peekFormat', { format: formatLabel(primaryFile) })"
        @click.stop="peekPrimaryFile"
      >
        <Eye :size="13" class="text-primary" />
      </button>
    </div>
  </div>

  <span v-else class="text-xs text-muted-foreground">-</span>
</template>
