<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  BookOpen,
  Check,
  Contrast,
  Copy,
  Highlighter,
  Palette,
  Smartphone,
  SquarePen,
  Strikethrough,
  Trash2,
  TriangleAlert,
  Underline,
  Waves,
} from '@lucide/vue'
import type { AnnotationItem } from '@bookorbit/types'
import { formatDate as formatLocaleDate } from '@/i18n/formatters'
import { sourcePill } from '@/features/annotations/lib/pill-styles'
import { copyToClipboard } from '@/lib/clipboard'

type Density = 'compact' | 'comfortable'

const props = withDefaults(
  defineProps<{
    annotation: AnnotationItem
    selected?: boolean
    active?: boolean
    density?: Density
    canJump?: boolean
    picking?: boolean
  }>(),
  { selected: false, active: false, density: 'comfortable', canJump: false, picking: false },
)

const emit = defineEmits<{
  open: [number]
  toggleSelect: [number]
  jump: [AnnotationItem]
  editNote: [number]
  restyle: [number]
  trash: [number]
}>()

const { t } = useI18n()

const STYLE_ICONS = { highlight: Highlighter, underline: Underline, strikethrough: Strikethrough, squiggly: Waves, invert: Contrast }

const expanded = ref(false)
const copied = ref(false)

const isLong = computed(() => props.annotation.text.length > (props.density === 'compact' ? 200 : 260))
const styleIcon = computed(() => STYLE_ICONS[props.annotation.style as keyof typeof STYLE_ICONS] ?? Highlighter)
const origin = computed(() => sourcePill(props.annotation.origin))
const originColor = computed(() => `var(--pill-${props.annotation.origin})`)
const needsReview = computed(() => props.annotation.positionStatus === 'failed' || props.annotation.positionStatus === 'repaired')

const createdAt = computed(() => {
  const date = new Date(props.annotation.createdAt)
  return Number.isNaN(date.getTime()) ? '' : formatLocaleDate(date, { month: 'short', day: 'numeric' })
})

function handleOpen() {
  emit('open', props.annotation.id)
}

function handleToggleSelect() {
  emit('toggleSelect', props.annotation.id)
}

function handleJump() {
  emit('jump', props.annotation)
}

function handleEditNote() {
  emit('editNote', props.annotation.id)
}

function handleRestyle() {
  emit('restyle', props.annotation.id)
}

function handleTrash() {
  emit('trash', props.annotation.id)
}

function handleToggleExpanded() {
  expanded.value = !expanded.value
}

function handleCopy() {
  void copyToClipboard(props.annotation.text)
  copied.value = true
  setTimeout(() => {
    copied.value = false
  }, 1500)
}
</script>

<template>
  <article
    class="group grid cursor-pointer grid-cols-[18px_3px_minmax(0,1fr)] gap-x-3 rounded-r-lg pr-0.5 transition-colors pointer-coarse:grid-cols-[28px_3px_minmax(0,1fr)] hover:bg-muted/45"
    :class="[density === 'compact' ? 'py-1.5' : 'py-2', active ? 'bg-primary/12 hover:bg-primary/12' : '', selected ? 'bg-primary/8' : '']"
    @click="handleOpen"
  >
    <label class="mt-0.5 flex h-4 items-center justify-center pointer-coarse:h-7" @click.stop>
      <input
        type="checkbox"
        class="size-3.5 cursor-pointer rounded-sm accent-[var(--primary)] transition-opacity pointer-coarse:size-5"
        :class="selected || picking ? 'opacity-100' : 'opacity-45 xl:opacity-0 xl:group-hover:opacity-100 xl:focus-visible:opacity-100'"
        :checked="selected"
        :aria-label="t('book.detail.highlights.row.select')"
        @change="handleToggleSelect"
      />
    </label>

    <span class="my-0.5 rounded-full" :style="{ background: annotation.color }" aria-hidden="true" />

    <div class="min-w-0">
      <p
        class="font-serif text-foreground"
        :class="[
          density === 'compact' ? 'text-[13.5px] leading-[1.45]' : 'text-[15px] leading-[1.55]',
          annotation.style === 'underline' ? 'underline decoration-[1.5px] underline-offset-[2.5px]' : '',
          annotation.style === 'strikethrough' ? 'line-through decoration-[1.5px]' : '',
          isLong && !expanded ? 'line-clamp-3' : '',
        ]"
      >
        {{ annotation.text }}
      </p>

      <button
        v-if="isLong"
        type="button"
        class="mt-0.5 inline-flex h-4 items-center text-[10.5px] font-semibold text-muted-foreground transition-colors pointer-coarse:h-7 hover:text-primary"
        @click.stop="handleToggleExpanded"
      >
        {{ expanded ? t('book.detail.highlights.row.showLess') : t('book.detail.highlights.row.showMore') }}
      </button>

      <div
        v-if="annotation.note"
        class="mt-1.5 max-w-[52rem] border-l-2 border-primary pl-2.5 text-[11.5px] leading-[1.5] text-foreground"
        :class="density === 'compact' ? 'mt-1.5 text-[11px] leading-[1.45]' : ''"
      >
        <span class="mb-0.5 block text-[8.5px] font-bold uppercase tracking-[0.13em] text-primary">{{ t('book.detail.highlights.row.note') }}</span>
        {{ annotation.note }}
      </div>

      <div class="mt-1.5 flex min-h-[17px] flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-muted-foreground">
        <span v-if="annotation.pageno != null" class="font-semibold tabular-nums">
          {{ t('book.detail.highlights.row.page', { page: annotation.pageno }) }}
        </span>
        <span v-if="annotation.pageno != null" class="size-[3px] shrink-0 rounded-full bg-muted-foreground" aria-hidden="true" />
        <span>{{ createdAt }}</span>
        <span class="size-[3px] shrink-0 rounded-full bg-muted-foreground" aria-hidden="true" />
        <span class="inline-flex items-center gap-1 whitespace-nowrap" :style="{ color: originColor }">
          <Smartphone v-if="annotation.origin !== 'web'" :size="10" />
          {{ origin.label }}
        </span>
        <template v-if="annotation.style !== 'highlight'">
          <span class="size-[3px] shrink-0 rounded-full bg-muted-foreground" aria-hidden="true" />
          <component :is="styleIcon" :size="10" />
        </template>
        <template v-if="needsReview">
          <span class="size-[3px] shrink-0 rounded-full bg-muted-foreground" aria-hidden="true" />
          <span class="inline-flex items-center gap-1 whitespace-nowrap text-amber-600 dark:text-amber-400">
            <TriangleAlert :size="10" />
            {{ annotation.positionStatus === 'failed' ? t('book.detail.highlights.row.anchorLost') : t('book.detail.highlights.row.reAnchored') }}
          </span>
        </template>

        <div
          class="ml-auto flex gap-px opacity-100 transition-opacity xl:opacity-0 xl:group-focus-within:opacity-100 xl:group-hover:opacity-100"
          @click.stop
        >
          <button
            type="button"
            class="grid size-5 place-items-center rounded text-muted-foreground transition-colors pointer-coarse:size-8 hover:bg-muted hover:text-foreground"
            :title="copied ? t('annotations.listItem.copied') : t('annotations.listItem.copyText')"
            :aria-label="t('annotations.listItem.copyText')"
            @click="handleCopy"
          >
            <Check v-if="copied" :size="12" class="text-primary" />
            <Copy v-else :size="12" />
          </button>
          <button
            v-if="canJump"
            type="button"
            class="grid size-5 place-items-center rounded text-muted-foreground transition-colors pointer-coarse:size-8 hover:bg-muted hover:text-foreground"
            :title="t('annotations.listItem.openInReader')"
            :aria-label="t('annotations.listItem.openInReader')"
            @click="handleJump"
          >
            <BookOpen :size="12" />
          </button>
          <button
            type="button"
            class="inline-flex h-5 items-center gap-1 rounded px-1.5 text-[10.5px] font-semibold text-muted-foreground transition-colors pointer-coarse:h-8 hover:bg-muted hover:text-foreground"
            :title="annotation.note ? t('annotations.listItem.editNote') : t('annotations.listItem.addNote')"
            :aria-label="annotation.note ? t('annotations.listItem.editNote') : t('annotations.listItem.addNote')"
            @click="handleEditNote"
          >
            <SquarePen :size="12" />
            <span v-if="!annotation.note">{{ t('book.detail.highlights.row.addNote') }}</span>
          </button>
          <button
            type="button"
            class="grid size-5 place-items-center rounded text-muted-foreground transition-colors pointer-coarse:size-8 hover:bg-muted hover:text-foreground"
            :title="t('annotations.listItem.colorAndStyle')"
            :aria-label="t('annotations.listItem.colorAndStyle')"
            @click="handleRestyle"
          >
            <Palette :size="12" />
          </button>
          <button
            type="button"
            class="grid size-5 place-items-center rounded text-muted-foreground transition-colors pointer-coarse:size-8 hover:bg-muted hover:text-destructive"
            :title="t('annotations.listItem.moveToTrash')"
            :aria-label="t('annotations.listItem.moveToTrash')"
            @click="handleTrash"
          >
            <Trash2 :size="12" />
          </button>
        </div>
      </div>
    </div>
  </article>
</template>
