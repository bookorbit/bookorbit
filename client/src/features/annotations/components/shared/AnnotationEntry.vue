<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import {
  ArchiveRestore,
  BookOpen,
  Check,
  Contrast,
  Highlighter,
  Palette,
  StickyNote,
  Strikethrough,
  Trash2,
  TriangleAlert,
  Underline,
  Waves,
} from '@lucide/vue'
import type { AnnotationHubItem, AnnotationItem } from '@bookorbit/types'
import { formatDate } from '@/i18n/formatters'
import { getFormatColor } from '@/features/book/lib/format-colors'
import AnnotationBookThumb from '../AnnotationBookThumb.vue'

type EntryAnnotation = AnnotationItem | AnnotationHubItem

const props = defineProps<{
  annotation: EntryAnnotation
  /** Below xl, or on any touch pointer, the source margin becomes a running head. */
  stacked: boolean
  selected: boolean
  selecting: boolean
  active: boolean
  compact: boolean
  trashed: boolean
  /** False while the row above shares this row's day, so the rail prints a date once per run. */
  showDay: boolean
  /**
   * False when the page is already about one book, or when a book group rule carries the
   * identity. The margin then leads with the chapter instead.
   */
  showBook: boolean
  /** Page or location to print in the margin, when the format resolved to one. */
  locationLabel?: string | null
  /**
   * A book page's margin has no book to name, so it carries only chapter, page and source
   * and does not need the library hub's 15rem. Without this it prints one word beside
   * 340px of nothing.
   */
  narrowMargin?: boolean
  /** False while the row above shares this row's chapter, inside a book group. */
  showChapter: boolean
}>()

const emit = defineEmits<{
  toggleSelect: [id: number]
  open: [id: number]
  jump: [annotation: EntryAnnotation]
  restore: [id: number]
  trash: [id: number]
  purge: [id: number]
}>()

const { t } = useI18n()

const STYLE_ICONS = { highlight: Highlighter, underline: Underline, strikethrough: Strikethrough, squiggly: Waves, invert: Contrast }

const created = computed(() => new Date(props.annotation.createdAt))
const dayLabel = computed(() => formatDate(created.value, { day: 'numeric', month: 'short' }))
const yearLabel = computed(() => formatDate(created.value, { year: 'numeric' }))
const hub = computed(() => ('bookTitle' in props.annotation ? props.annotation : null))
const bookTitle = computed(() => hub.value?.bookTitle ?? t('annotations.unknownBook'))
const author = computed(() => hub.value?.author ?? null)
const format = computed(() => hub.value?.jumpFileFormat?.trim().toUpperCase() ?? null)
const formatStyle = computed(() => {
  const color = getFormatColor(format.value)
  return { color, borderColor: `${color}66`, backgroundColor: `${color}1a` }
})
// A book page's rows carry no jumpFileFormat, so there it only needs a file to jump to.
const canJump = computed(() => props.annotation.jumpFileId != null && (hub.value == null || format.value != null) && !props.trashed)
const needsReview = computed(() => props.annotation.positionStatus != null && props.annotation.positionStatus !== 'exact')
const styleIcon = computed(() => STYLE_ICONS[props.annotation.style as keyof typeof STYLE_ICONS] ?? Highlighter)
const bookLink = computed(() => ({ name: 'book-detail', params: { bookId: props.annotation.bookId }, query: { tab: 'highlights' } }))

const quoteClass = computed(() => {
  const base = props.compact ? 'text-sm leading-relaxed' : 'text-base leading-[1.6]'
  if (props.annotation.style === 'underline') return `${base} underline decoration-[1.5px] underline-offset-[3px]`
  if (props.annotation.style === 'strikethrough') return `${base} line-through decoration-[1.5px]`
  return base
})

const coverClass = computed(() => {
  if (props.stacked) return 'h-[39px] w-[26px]'
  return props.compact ? 'h-12 w-8' : 'h-[66px] w-11'
})

function handleRowClick() {
  emit('open', props.annotation.id)
}

function handleToggleSelect() {
  emit('toggleSelect', props.annotation.id)
}

function handleJump() {
  emit('jump', props.annotation)
}

function handleRestore() {
  emit('restore', props.annotation.id)
}

function handleTrash() {
  emit('trash', props.annotation.id)
}

function handlePurge() {
  emit('purge', props.annotation.id)
}
</script>

<template>
  <article
    class="group relative grid cursor-pointer rounded-lg border-t border-border/50 transition-colors first:border-t-0"
    :class="[
      stacked
        ? 'grid-cols-[3.5rem_3px_minmax(0,1fr)] gap-x-3'
        : narrowMargin
          ? 'grid-cols-[4.5rem_3px_minmax(0,42rem)_9rem] gap-x-3.5'
          : 'grid-cols-[4.5rem_3px_minmax(0,42rem)_15rem] gap-x-3.5',
      compact ? 'py-2' : 'py-3',
      active ? 'bg-primary/10' : selected ? 'bg-primary/[0.08]' : 'hover:bg-muted/45',
    ]"
    @click="handleRowClick"
  >
    <!-- WHEN. In select mode the checkbox takes this same cell, so choosing rows shifts nothing. -->
    <div class="col-start-1 row-start-1 row-span-2 pt-0.5 text-right" :class="stacked ? '' : 'xl:row-span-1'">
      <button
        v-if="selecting"
        type="button"
        class="ml-auto grid size-[15px] place-items-center rounded border-[1.5px] transition-colors"
        :class="selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:border-primary'"
        :aria-pressed="selected"
        :aria-label="t('annotations.listItem.selectAnnotation')"
        @click.stop="handleToggleSelect"
      >
        <Check v-if="selected" :size="10" />
      </button>
      <template v-else-if="showDay">
        <span class="block text-[11px] font-semibold leading-[15px] text-muted-foreground transition-colors group-hover:text-foreground">
          {{ dayLabel }}
        </span>
        <span class="block text-[9.5px] leading-[14px] text-muted-foreground">{{ yearLabel }}</span>
      </template>
    </div>

    <span class="col-start-2 row-start-1 row-span-2 my-[3px] self-stretch rounded-full" :style="{ backgroundColor: annotation.color }" />

    <!-- WHAT -->
    <div class="col-start-3 min-w-0" :class="stacked ? 'row-start-2' : 'row-start-1'">
      <p class="text-foreground" :class="quoteClass">{{ annotation.text }}</p>
      <div v-if="annotation.note" class="mt-2 border-l-2 border-primary pl-2.5">
        <span class="mb-0.5 block text-[8.5px] font-bold uppercase tracking-[0.13em] text-primary">{{ t('annotations.hub.noteLabel') }}</span>
        <p class="text-[11.5px] leading-relaxed text-foreground">{{ annotation.note }}</p>
      </div>
      <div class="mt-1.5 flex min-h-[17px] items-center gap-2 text-[10.5px] text-muted-foreground">
        <span v-if="annotation.style !== 'highlight'" class="inline-flex items-center gap-1">
          <component :is="styleIcon" :size="10" />
          {{
            t(
              `annotations.styles.${annotation.style === 'strikethrough' ? 'strike' : annotation.style === 'squiggly' ? 'squiggle' : annotation.style}`,
            )
          }}
        </span>
        <span v-if="needsReview" class="inline-flex items-center gap-1 text-[var(--pill-repaired)]">
          <TriangleAlert :size="11" />
          {{ annotation.positionStatus === 'failed' ? t('annotations.hub.anchorLost') : t('annotations.hub.anchorRepaired') }}
        </span>
        <div class="ml-auto flex gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
          <button
            v-if="trashed"
            type="button"
            class="inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-[11px] font-semibold text-foreground transition-colors hover:bg-muted hover:text-primary"
            @click.stop="handleRestore"
          >
            <ArchiveRestore :size="13" />
            {{ t('annotations.listItem.restore') }}
          </button>
          <button
            v-if="trashed"
            type="button"
            class="grid size-6 place-items-center rounded-md text-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            :aria-label="t('annotations.listItem.deleteForever')"
            @click.stop="handlePurge"
          >
            <Trash2 :size="14" />
          </button>
          <template v-else>
            <button
              v-if="canJump"
              type="button"
              class="grid size-6 place-items-center rounded-md text-foreground transition-colors hover:bg-muted hover:text-primary"
              :aria-label="t('annotations.listItem.openInReader')"
              @click.stop="handleJump"
            >
              <BookOpen :size="14" />
            </button>
            <button
              type="button"
              class="grid size-6 place-items-center rounded-md text-foreground transition-colors hover:bg-muted hover:text-primary"
              :aria-label="t('annotations.listItem.editNote')"
              @click.stop="handleRowClick"
            >
              <StickyNote :size="14" />
            </button>
            <button
              type="button"
              class="grid size-6 place-items-center rounded-md text-foreground transition-colors hover:bg-muted hover:text-primary"
              :aria-label="t('annotations.listItem.colorAndStyle')"
              @click.stop="handleRowClick"
            >
              <Palette :size="14" />
            </button>
            <button
              type="button"
              class="grid size-6 place-items-center rounded-md text-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              :aria-label="t('annotations.listItem.moveToTrash')"
              @click.stop="handleTrash"
            >
              <Trash2 :size="14" />
            </button>
          </template>
        </div>
      </div>
    </div>

    <!-- WHERE FROM. A column your eye can scan or ignore, and every row has one. -->
    <div
      class="col-start-3 flex min-w-0 items-start gap-2.5"
      :class="stacked ? 'row-start-1 items-center pb-2' : 'row-start-1 col-start-4 border-l border-border/60 pl-3.5 pt-px'"
    >
      <RouterLink v-if="showBook" :to="bookLink" class="shrink-0" @click.stop>
        <AnnotationBookThumb :book-id="annotation.bookId" :title="bookTitle" :class="coverClass" />
      </RouterLink>
      <div class="flex min-w-0 flex-col" :class="stacked ? 'flex-row flex-wrap items-baseline gap-x-2' : ''">
        <RouterLink
          v-if="showBook"
          :to="bookLink"
          class="text-[12px] font-semibold leading-4 text-foreground transition-colors hover:text-primary"
          :class="stacked ? 'truncate' : 'line-clamp-2'"
          @click.stop
        >
          {{ bookTitle }}
        </RouterLink>
        <span v-if="showBook && author" class="truncate text-[11px] leading-[15px] text-muted-foreground" :class="stacked ? '' : 'mt-0.5'">
          {{ author }}
        </span>
        <!--
          With no book to name, the chapter takes the margin's leading rank instead of
          trailing as a grey aside, so the column stays occupied and worth scanning.
        -->
        <span
          v-if="!showBook && showChapter && annotation.chapterTitle"
          class="text-[12px] font-semibold leading-4 text-foreground"
          :class="stacked ? 'truncate' : 'line-clamp-2'"
        >
          {{ annotation.chapterTitle }}
        </span>
        <span class="flex min-w-0 items-center gap-1.5" :class="stacked ? '' : 'mt-1'">
          <span v-if="showBook && showChapter && annotation.chapterTitle" class="truncate text-[10px] leading-[14px] text-muted-foreground">
            {{ annotation.chapterTitle }}
          </span>
          <span v-if="locationLabel" class="shrink-0 text-[10px] font-semibold leading-[14px] text-muted-foreground">{{ locationLabel }}</span>
          <span class="inline-flex shrink-0 items-center gap-1 text-[10px] leading-[14px]" :style="{ color: `var(--pill-${annotation.origin})` }">
            {{ t(`annotations.sources.${annotation.origin}`) }}
          </span>
          <span
            v-if="format"
            class="inline-flex h-[14px] shrink-0 items-center rounded-sm border px-1 text-[8.5px] font-bold tracking-[0.06em]"
            :style="formatStyle"
          >
            {{ format }}
          </span>
        </span>
      </div>
    </div>

    <div v-if="active" class="col-start-3 min-w-0" :class="stacked ? 'row-start-3' : 'row-start-2 col-span-2'" @click.stop>
      <slot name="detail" />
    </div>
  </article>
</template>
