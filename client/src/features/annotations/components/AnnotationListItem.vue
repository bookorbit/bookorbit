<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  ArchiveRestore,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Contrast,
  Copy,
  FileEdit,
  Highlighter,
  Info,
  Palette,
  Smartphone,
  Strikethrough,
  Trash2,
  TriangleAlert,
  Underline,
  Waves,
  X,
} from '@lucide/vue'
import { RouterLink } from 'vue-router'
import { ANNOTATION_HIGHLIGHT_COLORS, type AnnotationHubItem, type AnnotationItem } from '@bookorbit/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { PILL_CLASS, sourcePill, statusPill } from '@/features/annotations/lib/pill-styles'
import HighlightNoteEditor from '@/features/book/components/detail/tabs/HighlightNoteEditor.vue'
import AnnotationBookThumb from './AnnotationBookThumb.vue'
import AnnotationSyncDetailPanel from './AnnotationSyncDetailPanel.vue'
import { copyToClipboard } from '@/lib/clipboard'

type AnnotationListItemMode = 'book' | 'hub'
type AnnotationListDensity = 'compact' | 'comfortable'
type AnnotationListItem = AnnotationItem | AnnotationHubItem

const props = withDefaults(
  defineProps<{
    annotation: AnnotationListItem
    selected?: boolean
    selectable?: boolean
    trashed?: boolean
    mode?: AnnotationListItemMode
    density?: AnnotationListDensity
    saving?: boolean
    showBookHeader?: boolean
  }>(),
  {
    selected: false,
    selectable: true,
    trashed: false,
    mode: 'hub',
    density: 'comfortable',
    saving: false,
    showBookHeader: false,
  },
)

const emit = defineEmits<{
  toggleSelect: [id: number]
  jump: [annotation: AnnotationListItem]
  trash: [id: number]
  restore: [id: number]
  purge: [id: number]
  updateNote: [id: number, note: string | null]
  updateColor: [id: number, color: string]
  updateStyle: [id: number, style: string]
}>()

const COLORS = ANNOTATION_HIGHLIGHT_COLORS

const STYLES = [
  { value: 'highlight', label: 'Highlight', icon: Highlighter },
  { value: 'underline', label: 'Underline', icon: Underline },
  { value: 'strikethrough', label: 'Strike', icon: Strikethrough },
  { value: 'squiggly', label: 'Squiggle', icon: Waves },
  { value: 'invert', label: 'Invert', icon: Contrast },
]

const expanded = ref(false)
const editingNote = ref(false)
const showStylePanel = ref(false)
const showSyncDetail = ref(false)
const confirmTrash = ref(false)
const copied = ref(false)
const pendingNote = ref<string | null | undefined>(undefined)

const canEdit = computed(() => !props.trashed)
const canJump = computed(() => props.annotation.jumpFileId != null && !props.trashed)
const isLong = computed(() => props.annotation.text.length > (props.density === 'compact' ? 180 : 260))
const isApproximate = computed(() => props.annotation.cfi == null && props.annotation.origin !== 'web')
const hasBookTitle = computed(() => 'bookTitle' in props.annotation && props.annotation.bookTitle != null)
const showBookHeader = computed(() => props.mode === 'hub' && props.showBookHeader)
const bookTitleText = computed(() => (hasBookTitle.value && 'bookTitle' in props.annotation ? props.annotation.bookTitle : 'Unknown book'))
const bookAuthor = computed(() => ('author' in props.annotation ? props.annotation.author : null))
const bookLink = computed(() => ({ name: 'book-detail', params: { bookId: props.annotation.bookId }, query: { tab: 'highlights' } }))

const styleLabel = computed(() => {
  return STYLES.find((s) => s.value === props.annotation.style)?.label ?? props.annotation.style
})

const styleIcon = computed(() => {
  return STYLES.find((s) => s.value === props.annotation.style)?.icon ?? Highlighter
})

const originPill = computed(() => sourcePill(props.annotation.origin))
const positionPill = computed(() => statusPill(props.annotation.positionStatus, isApproximate.value))
const hasMetadataBeforeSource = computed(() => showBookHeader.value || metadataItems.value.length > 0)

const cardClass = computed(() => [
  props.selected ? 'ring-1 ring-primary border-primary/50' : 'hover:border-primary/30',
  props.density === 'compact' ? 'p-2.5 gap-2' : 'p-3 gap-3',
])

const quoteClampClass = computed(() => (expanded.value ? '' : props.density === 'compact' ? 'line-clamp-2' : 'line-clamp-3'))
const noteClampClass = computed(() => (expanded.value ? '' : props.density === 'compact' ? 'line-clamp-1' : 'line-clamp-2'))

const metadataItems = computed(() => {
  const items: string[] = []
  if (props.mode !== 'hub' && hasBookTitle.value && 'bookTitle' in props.annotation) items.push(props.annotation.bookTitle ?? 'Unknown book')
  if (props.annotation.chapterTitle) items.push(props.annotation.chapterTitle)
  if (props.annotation.pageno != null) items.push(`p. ${props.annotation.pageno}`)
  if (props.annotation.chapterIndex != null) items.push(`chapter ${props.annotation.chapterIndex + 1}`)
  const date = formatDate(props.annotation.createdAt)
  if (date) items.push(date)
  return items
})

watch(
  () => props.saving,
  (saving, wasSaving) => {
    if (saving || !wasSaving || pendingNote.value === undefined) return
    if (props.annotation.note === pendingNote.value) {
      editingNote.value = false
      pendingNote.value = undefined
    }
  },
)

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function handleToggleSelect() {
  emit('toggleSelect', props.annotation.id)
}

function handleJump() {
  emit('jump', props.annotation)
}

function handleCopy() {
  void copyToClipboard(props.annotation.text)
  copied.value = true
  setTimeout(() => {
    copied.value = false
  }, 1500)
}

function handleTrash() {
  if (props.mode === 'book' && !confirmTrash.value) {
    confirmTrash.value = true
    return
  }
  emit('trash', props.annotation.id)
  confirmTrash.value = false
}

function handleCancelTrash() {
  confirmTrash.value = false
}

function handleRestore() {
  emit('restore', props.annotation.id)
}

function handlePurge() {
  emit('purge', props.annotation.id)
}

function handleNoteSave(note: string | null) {
  pendingNote.value = note
  emit('updateNote', props.annotation.id, note)
}

function handleNoteCancel() {
  editingNote.value = false
}

function toggleExpanded() {
  expanded.value = !expanded.value
}

function toggleNoteEditor() {
  editingNote.value = !editingNote.value
}

function toggleStylePanel() {
  showStylePanel.value = !showStylePanel.value
}

function toggleSyncDetail() {
  showSyncDetail.value = !showSyncDetail.value
}

function handleColorSelect(color: string) {
  if (color !== props.annotation.color) emit('updateColor', props.annotation.id, color)
}

function handleStyleSelect(style: string) {
  if (style !== props.annotation.style) emit('updateStyle', props.annotation.id, style)
}

function shouldSeparateMetadataItem(index: number): boolean {
  return showBookHeader.value || index > 0
}
</script>

<template>
  <div class="flex items-start rounded-lg border border-border bg-card transition-colors" :class="cardClass">
    <input
      v-if="selectable"
      type="checkbox"
      class="mt-1 h-4 w-4 shrink-0 accent-[var(--primary)] cursor-pointer"
      :checked="selected"
      aria-label="Select annotation"
      @change="handleToggleSelect"
    />

    <RouterLink
      v-if="showBookHeader"
      :to="bookLink"
      class="mt-0.5 block shrink-0 transition-opacity hover:opacity-90"
      :class="density === 'compact' ? 'w-11' : 'w-14'"
    >
      <AnnotationBookThumb :book-id="annotation.bookId" :title="bookTitleText" class="w-full" style="aspect-ratio: 2 / 3" />
    </RouterLink>

    <Tooltip v-else>
      <TooltipTrigger as-child>
        <span
          class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border bg-muted"
          :style="{ color: annotation.color }"
        >
          <component :is="styleIcon" :size="16" />
        </span>
      </TooltipTrigger>
      <TooltipContent>{{ styleLabel }}</TooltipContent>
    </Tooltip>

    <div class="flex flex-1 min-w-0 flex-col self-stretch">
      <p class="text-sm leading-relaxed text-foreground" :class="quoteClampClass">
        {{ annotation.text }}
      </p>

      <button
        v-if="isLong"
        type="button"
        class="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        @click="toggleExpanded"
      >
        <ChevronUp v-if="expanded" :size="13" />
        <ChevronDown v-else :size="13" />
        {{ expanded ? 'Collapse' : 'Expand' }}
      </button>

      <p
        v-if="annotation.note && !editingNote"
        class="mt-2 border-l-2 border-muted pl-2 text-xs italic text-muted-foreground"
        :class="noteClampClass"
      >
        {{ annotation.note }}
      </p>

      <HighlightNoteEditor v-if="editingNote" :initial-note="annotation.note" :saving="saving" @save="handleNoteSave" @cancel="handleNoteCancel" />

      <AnnotationSyncDetailPanel v-if="showSyncDetail" :annotation-id="annotation.id" />

      <div v-if="showStylePanel && canEdit" class="mt-2 flex flex-col gap-2 rounded-md border border-border bg-background p-2">
        <div class="flex flex-wrap items-center gap-1.5">
          <button
            v-for="c in COLORS"
            :key="c.hex"
            type="button"
            class="h-6 w-6 rounded-full border-2 transition-transform hover:scale-110"
            :class="annotation.color === c.hex ? 'border-foreground scale-110' : 'border-transparent'"
            :style="{ background: c.hex }"
            :title="c.label"
            @click="() => handleColorSelect(c.hex)"
          />
        </div>
        <div class="flex flex-wrap items-center gap-1">
          <Tooltip v-for="s in STYLES" :key="s.value">
            <TooltipTrigger as-child>
              <button
                type="button"
                class="flex h-7 w-7 items-center justify-center rounded border text-xs transition-colors"
                :class="
                  annotation.style === s.value
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground'
                "
                :style="annotation.style === s.value ? { color: annotation.color } : undefined"
                @click="() => handleStyleSelect(s.value)"
              >
                <component :is="s.icon" :size="13" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{{ s.label }}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div class="mt-auto flex flex-col gap-2 pt-2 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
          <template v-if="showBookHeader">
            <component :is="styleIcon" :size="13" class="shrink-0" :style="{ color: annotation.color }" />
            <RouterLink
              :to="bookLink"
              class="truncate max-w-[16rem] text-xs font-semibold text-foreground transition-colors hover:text-primary hover:underline"
            >
              {{ bookTitleText }}
            </RouterLink>
            <span v-if="bookAuthor" aria-hidden="true" class="mx-0.5 block h-1 w-1 shrink-0 rounded-full bg-muted-foreground/70" />
            <span v-if="bookAuthor" class="truncate max-w-[12rem]">{{ bookAuthor }}</span>
          </template>
          <template v-for="(item, index) in metadataItems" :key="`${item}-${index}`">
            <span
              v-if="shouldSeparateMetadataItem(index)"
              aria-hidden="true"
              class="mx-0.5 block h-1 w-1 shrink-0 rounded-full bg-muted-foreground/70"
            />
            <span class="truncate max-w-[14rem]">{{ item }}</span>
          </template>
          <span v-if="hasMetadataBeforeSource" aria-hidden="true" class="mx-0.5 block h-1 w-1 shrink-0 rounded-full bg-muted-foreground/70" />
          <span :class="[PILL_CLASS, originPill.class]">
            <Smartphone v-if="annotation.origin === 'koreader' || annotation.origin === 'kobo'" :size="10" />
            {{ originPill.label }}
          </span>
          <Tooltip v-if="positionPill">
            <TooltipTrigger as-child>
              <button type="button" :class="[PILL_CLASS, positionPill.class, 'transition-colors hover:opacity-80']" @click="toggleSyncDetail">
                {{ positionPill.label }}
              </button>
            </TooltipTrigger>
            <TooltipContent>{{ showSyncDetail ? 'Hide sync detail' : 'Show sync detail' }}</TooltipContent>
          </Tooltip>
          <Tooltip v-if="isApproximate">
            <TooltipTrigger as-child>
              <TriangleAlert :size="12" class="text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent>Exact reader position unavailable</TooltipContent>
          </Tooltip>
          <span v-if="saving" class="text-primary">Saving</span>
        </div>

        <div class="flex shrink-0 flex-wrap justify-start gap-0.5 sm:flex-nowrap sm:justify-end">
          <Tooltip>
            <TooltipTrigger as-child>
              <RouterLink
                :to="{ name: 'book-detail', params: { bookId: annotation.bookId }, query: { tab: 'details' } }"
                class="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-primary"
              >
                <Info :size="15" />
              </RouterLink>
            </TooltipTrigger>
            <TooltipContent>Book details</TooltipContent>
          </Tooltip>

          <Tooltip v-if="canJump">
            <TooltipTrigger as-child>
              <button
                type="button"
                class="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-primary"
                @click="handleJump"
              >
                <BookOpen :size="15" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Open in reader</TooltipContent>
          </Tooltip>

          <template v-if="trashed">
            <Tooltip>
              <TooltipTrigger as-child>
                <button
                  type="button"
                  class="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-primary"
                  @click="handleRestore"
                >
                  <ArchiveRestore :size="15" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Restore</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <button
                  type="button"
                  class="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                  @click="handlePurge"
                >
                  <Trash2 :size="15" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Delete forever</TooltipContent>
            </Tooltip>
          </template>

          <template v-else>
            <Tooltip v-if="canEdit">
              <TooltipTrigger as-child>
                <button
                  type="button"
                  class="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  @click="toggleNoteEditor"
                >
                  <FileEdit :size="14" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{{ annotation.note ? 'Edit note' : 'Add note' }}</TooltipContent>
            </Tooltip>

            <Tooltip v-if="canEdit">
              <TooltipTrigger as-child>
                <button
                  type="button"
                  class="flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-muted hover:text-foreground"
                  :class="showStylePanel ? 'bg-muted text-foreground' : 'text-muted-foreground'"
                  @click="toggleStylePanel"
                >
                  <Palette :size="14" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Color and style</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger as-child>
                <button
                  type="button"
                  class="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  @click="handleCopy"
                >
                  <Check v-if="copied" :size="14" class="text-primary" />
                  <Copy v-else :size="14" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{{ copied ? 'Copied' : 'Copy text' }}</TooltipContent>
            </Tooltip>

            <template v-if="confirmTrash && mode === 'book'">
              <button
                type="button"
                class="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title="Cancel"
                @click="handleCancelTrash"
              >
                <X :size="14" />
              </button>
              <button
                type="button"
                class="h-7 rounded bg-destructive/15 px-2 text-[10px] font-medium uppercase text-destructive ring-1 ring-destructive/40"
                @click="handleTrash"
              >
                Trash
              </button>
            </template>
            <Tooltip v-else>
              <TooltipTrigger as-child>
                <button
                  type="button"
                  class="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                  @click="handleTrash"
                >
                  <Trash2 :size="14" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Move to trash</TooltipContent>
            </Tooltip>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
