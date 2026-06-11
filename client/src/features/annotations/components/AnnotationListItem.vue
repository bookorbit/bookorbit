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
  Palette,
  Smartphone,
  Strikethrough,
  Trash2,
  TriangleAlert,
  Underline,
  Waves,
  X,
} from 'lucide-vue-next'
import type { AnnotationHubItem, AnnotationItem } from '@bookorbit/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import HighlightNoteEditor from '@/features/book/components/detail/tabs/HighlightNoteEditor.vue'
import AnnotationSyncDetailPanel from './AnnotationSyncDetailPanel.vue'

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
  }>(),
  {
    selected: false,
    selectable: true,
    trashed: false,
    mode: 'hub',
    density: 'comfortable',
    saving: false,
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

const COLORS = [
  { hex: '#FACC15', label: 'Yellow' },
  { hex: '#4ADE80', label: 'Green' },
  { hex: '#38BDF8', label: 'Blue' },
  { hex: '#F472B6', label: 'Pink' },
  { hex: '#FB923C', label: 'Orange' },
  { hex: '#FFFF33', label: 'Device yellow' },
  { hex: '#88FF77', label: 'Device olive' },
]

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

const canEdit = computed(() => props.mode === 'book' && !props.trashed)
const canJump = computed(() => props.annotation.jumpFileId != null && !props.trashed)
const isLong = computed(() => props.annotation.text.length > (props.density === 'compact' ? 180 : 260))
const isApproximate = computed(() => props.annotation.cfi == null && props.annotation.origin !== 'web')
const hasBookTitle = computed(() => 'bookTitle' in props.annotation && props.annotation.bookTitle != null)

const styleLabel = computed(() => {
  return STYLES.find((s) => s.value === props.annotation.style)?.label ?? props.annotation.style
})

const styleIcon = computed(() => {
  return STYLES.find((s) => s.value === props.annotation.style)?.icon ?? Highlighter
})

const originLabel = computed(() => {
  if (props.annotation.origin === 'koreader') return 'KOReader'
  if (props.annotation.origin === 'kobo') return 'Kobo'
  return 'Web'
})

const originClass = computed(() => {
  if (props.annotation.origin === 'web') return 'border-primary/30 bg-primary/10 text-primary'
  if (props.annotation.origin === 'kobo') return 'border-destructive/30 bg-destructive/10 text-destructive'
  return 'border-border bg-secondary text-secondary-foreground'
})

const positionStatusLabel = computed(() => {
  const status = props.annotation.positionStatus
  if (!status) return isApproximate.value ? 'Approximate' : null
  if (status === 'exact') return 'Exact'
  if (status === 'repaired') return 'Repaired'
  if (status === 'pending') return 'Pending'
  return 'Failed'
})

const positionStatusClass = computed(() => {
  const status = props.annotation.positionStatus
  if (status === 'exact') return 'border-primary/30 bg-primary/10 text-primary'
  if (status === 'repaired') return 'border-primary/30 bg-primary/10 text-primary'
  if (status === 'pending') return 'border-border bg-muted text-muted-foreground'
  if (status === 'failed') return 'border-destructive/30 bg-destructive/10 text-destructive'
  return 'border-border bg-muted text-muted-foreground'
})

const cardClass = computed(() => [
  props.selected ? 'ring-1 ring-primary border-primary/50' : 'hover:border-primary/30',
  props.density === 'compact' ? 'p-2.5 gap-2' : 'p-3 gap-3',
])

const quoteClampClass = computed(() => (expanded.value ? '' : props.density === 'compact' ? 'line-clamp-2' : 'line-clamp-3'))
const noteClampClass = computed(() => (expanded.value ? '' : props.density === 'compact' ? 'line-clamp-1' : 'line-clamp-2'))

const metadataItems = computed(() => {
  const items: string[] = []
  if (hasBookTitle.value && 'bookTitle' in props.annotation) items.push(props.annotation.bookTitle ?? 'Unknown book')
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
  navigator.clipboard?.writeText(props.annotation.text).catch(() => {})
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

    <Tooltip>
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

    <div class="flex-1 min-w-0">
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

      <div class="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          <span v-for="item in metadataItems" :key="item" class="truncate max-w-[14rem]">{{ item }}</span>
          <span class="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium" :class="originClass">
            <Smartphone v-if="annotation.origin === 'koreader' || annotation.origin === 'kobo'" :size="10" />
            {{ originLabel }}
          </span>
          <Tooltip v-if="positionStatusLabel">
            <TooltipTrigger as-child>
              <button
                type="button"
                class="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors hover:opacity-80"
                :class="positionStatusClass"
                @click="toggleSyncDetail"
              >
                {{ positionStatusLabel }}
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
          <Tooltip v-if="canJump">
            <TooltipTrigger as-child>
              <button
                type="button"
                class="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:text-primary"
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
                  class="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:text-primary"
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
                  class="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:text-destructive"
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
