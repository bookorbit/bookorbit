<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Contrast,
  Copy,
  Highlighter,
  Smartphone,
  SquarePen,
  StickyNote,
  Strikethrough,
  Trash2,
  Underline,
  Waves,
} from '@lucide/vue'
import type { AnnotationItem } from '@bookorbit/types'
import { ANNOTATION_HIGHLIGHT_COLORS } from '@bookorbit/types'
import { formatDate as formatLocaleDate } from '@/i18n/formatters'
import { PILL_CLASS, sourcePill, statusPill } from '@/features/annotations/lib/pill-styles'
import AnnotationSyncDetailPanel from '@/features/annotations/components/AnnotationSyncDetailPanel.vue'
import HighlightNoteEditor from '@/features/book/components/detail/tabs/HighlightNoteEditor.vue'
import { copyToClipboard } from '@/lib/clipboard'

const props = defineProps<{
  annotation: AnnotationItem
  position: number
  total: number
  saving: boolean
  canJump: boolean
  editingNote: boolean
}>()

const emit = defineEmits<{
  close: []
  step: [number]
  jump: [AnnotationItem]
  updateNote: [number, string | null]
  updateColor: [number, string]
  updateStyle: [number, string]
  trash: [number]
  editNote: [number]
  cancelNote: []
}>()

const { t } = useI18n()

const STYLES = computed(() => [
  { value: 'highlight', label: t('annotations.styles.highlight'), icon: Highlighter },
  { value: 'underline', label: t('annotations.styles.underline'), icon: Underline },
  { value: 'strikethrough', label: t('annotations.styles.strike'), icon: Strikethrough },
  { value: 'squiggly', label: t('annotations.styles.squiggle'), icon: Waves },
  { value: 'invert', label: t('annotations.styles.invert'), icon: Contrast },
])

const COLORS = ANNOTATION_HIGHLIGHT_COLORS

const copied = ref(false)
const showSyncDetail = ref(false)

const origin = computed(() => sourcePill(props.annotation.origin))
const isApproximate = computed(() => props.annotation.cfi == null && props.annotation.origin !== 'web')
const positionPill = computed(() => statusPill(props.annotation.positionStatus, isApproximate.value))
const createdAt = computed(() => {
  const date = new Date(props.annotation.createdAt)
  return Number.isNaN(date.getTime()) ? '' : formatLocaleDate(date, { year: 'numeric', month: 'short', day: 'numeric' })
})

watch(
  () => props.annotation.id,
  () => {
    showSyncDetail.value = false
  },
)

function handleClose() {
  emit('close')
}
function handlePrevious() {
  emit('step', -1)
}
function handleNext() {
  emit('step', 1)
}
function handleJump() {
  emit('jump', props.annotation)
}
function handleTrash() {
  emit('trash', props.annotation.id)
}
function handleEditNote() {
  emit('editNote', props.annotation.id)
}
function handleCancelNote() {
  emit('cancelNote')
}
function handleNoteSave(note: string | null) {
  emit('updateNote', props.annotation.id, note)
}
function handleToggleSyncDetail() {
  showSyncDetail.value = !showSyncDetail.value
}
function handleCopy() {
  void copyToClipboard(props.annotation.text)
  copied.value = true
  setTimeout(() => {
    copied.value = false
  }, 1500)
}
function handleColorSelect(hex: string) {
  if (hex !== props.annotation.color) emit('updateColor', props.annotation.id, hex)
}
function handleStyleSelect(style: string) {
  if (style !== props.annotation.style) emit('updateStyle', props.annotation.id, style)
}
</script>

<template>
  <section
    class="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card"
    :aria-label="t('book.detail.highlights.inspector.title')"
  >
    <header class="flex h-[34px] flex-none items-center gap-1.5 border-b border-border px-2">
      <button
        type="button"
        class="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors pointer-coarse:size-9 hover:bg-muted hover:text-foreground"
        :aria-label="t('book.detail.highlights.inspector.back')"
        @click="handleClose"
      >
        <ChevronLeft :size="13" />
      </button>
      <h2 class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {{ t('book.detail.highlights.inspector.counter', { position, total }) }}
      </h2>
      <div class="ml-auto flex items-center gap-0.5">
        <button
          type="button"
          class="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors pointer-coarse:size-9 hover:bg-muted hover:text-foreground disabled:opacity-40"
          :disabled="position <= 1"
          :aria-label="t('book.detail.highlights.inspector.previous')"
          @click="handlePrevious"
        >
          <ChevronUp :size="12" />
        </button>
        <button
          type="button"
          class="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors pointer-coarse:size-9 hover:bg-muted hover:text-foreground disabled:opacity-40"
          :disabled="position >= total"
          :aria-label="t('book.detail.highlights.inspector.next')"
          @click="handleNext"
        >
          <ChevronDown :size="12" />
        </button>
      </div>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-2.5 [scrollbar-gutter:stable]">
      <p class="truncate text-[11px] font-semibold text-foreground">{{ annotation.chapterTitle ?? t('book.detail.highlights.uncategorized') }}</p>
      <p class="mt-0.5 text-[10.5px] text-muted-foreground">
        <template v-if="annotation.pageno != null">{{ t('book.detail.highlights.row.page', { page: annotation.pageno }) }} &middot; </template>
        {{ createdAt }}
        <span aria-hidden="true"> &middot; </span>
        <span class="inline-flex items-center gap-1" :style="{ color: `var(--pill-${annotation.origin})` }">
          <Smartphone v-if="annotation.origin !== 'web'" :size="10" />
          {{ origin.label }}
        </span>
      </p>

      <blockquote class="relative mt-2.5 pl-3">
        <span class="absolute inset-y-0.5 left-0 w-[3px] rounded-full" :style="{ background: annotation.color }" aria-hidden="true" />
        <p class="font-serif text-[14.5px] leading-[1.55] text-foreground">{{ annotation.text }}</p>
      </blockquote>

      <div class="mt-3 overflow-hidden rounded-lg border border-border bg-muted/40">
        <header class="flex h-[26px] items-center gap-1.5 border-b border-border px-2.5">
          <StickyNote :size="12" class="text-muted-foreground" />
          <h3 class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{{ t('book.detail.highlights.row.note') }}</h3>
          <button
            v-if="!editingNote"
            type="button"
            class="ml-auto inline-flex h-5 items-center gap-1 rounded px-1.5 text-[11px] font-medium text-muted-foreground transition-colors pointer-coarse:h-8 hover:bg-muted hover:text-foreground"
            @click="handleEditNote"
          >
            <SquarePen :size="11" />
            {{ annotation.note ? t('annotations.listItem.editNote') : t('book.detail.highlights.row.addNote') }}
          </button>
        </header>
        <div class="px-2.5 pb-2.5 pt-2">
          <HighlightNoteEditor
            v-if="editingNote"
            :initial-note="annotation.note"
            :saving="saving"
            @save="handleNoteSave"
            @cancel="handleCancelNote"
          />
          <p v-else-if="annotation.note" class="text-[11.5px] leading-[1.55] text-foreground">{{ annotation.note }}</p>
          <p v-else class="text-[11.5px] italic leading-[1.55] text-muted-foreground">{{ t('book.detail.highlights.inspector.notePrompt') }}</p>
        </div>
      </div>

      <div class="mt-3 flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-2.5">
        <div class="flex flex-wrap gap-1" role="group" :aria-label="t('annotations.filters.colors')">
          <button
            v-for="option in COLORS"
            :key="option.hex"
            type="button"
            class="size-[17px] rounded-full border-2 transition-transform pointer-coarse:size-8 hover:scale-110"
            :class="annotation.color === option.hex ? 'border-foreground scale-110' : 'border-transparent'"
            :style="{ background: option.hex }"
            :title="option.label"
            :aria-label="option.label"
            :aria-pressed="annotation.color === option.hex"
            @click="() => handleColorSelect(option.hex)"
          />
        </div>
        <div class="flex flex-wrap gap-1" role="group" :aria-label="t('book.detail.highlights.inspector.style')">
          <button
            v-for="option in STYLES"
            :key="option.value"
            type="button"
            class="grid h-[21px] w-[23px] place-items-center rounded-md border transition-colors pointer-coarse:size-8"
            :class="
              annotation.style === option.value
                ? 'border-primary bg-primary/15 text-primary'
                : 'border-border text-muted-foreground hover:text-foreground'
            "
            :title="option.label"
            :aria-label="option.label"
            :aria-pressed="annotation.style === option.value"
            @click="() => handleStyleSelect(option.value)"
          >
            <component :is="option.icon" :size="12" />
          </button>
        </div>
      </div>

      <div class="mt-3 overflow-hidden rounded-lg border border-border">
        <header class="flex h-[26px] items-center gap-1.5 border-b border-border bg-muted/40 px-2.5">
          <Smartphone :size="12" class="text-muted-foreground" />
          <h3 class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {{ t('book.detail.highlights.inspector.position') }}
          </h3>
          <button
            v-if="positionPill"
            type="button"
            :class="[PILL_CLASS, positionPill.class, 'ml-auto transition-opacity hover:opacity-80']"
            @click="handleToggleSyncDetail"
          >
            {{ positionPill.label }}
          </button>
        </header>
        <div class="px-2.5 py-2">
          <AnnotationSyncDetailPanel v-if="showSyncDetail" :annotation-id="annotation.id" />
          <button
            v-else
            type="button"
            class="text-[11px] text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
            @click="handleToggleSyncDetail"
          >
            {{ t('annotations.listItem.showSyncDetail') }}
          </button>
        </div>
      </div>
    </div>

    <div class="flex flex-none items-center gap-1.5 border-t border-border px-2.5 py-2">
      <button
        v-if="canJump"
        type="button"
        class="inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md border border-border text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        @click="handleJump"
      >
        <BookOpen :size="11" />
        {{ t('book.detail.highlights.inspector.openHere') }}
      </button>
      <button
        type="button"
        class="inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md border border-border text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        @click="handleCopy"
      >
        <Copy :size="11" />
        {{ copied ? t('annotations.listItem.copied') : t('annotations.listItem.copyText') }}
      </button>
      <button
        type="button"
        class="grid size-7 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        :aria-label="t('annotations.listItem.moveToTrash')"
        @click="handleTrash"
      >
        <Trash2 :size="12" />
      </button>
    </div>
  </section>
</template>
