<script setup lang="ts">
import { computed } from 'vue'
import { ArchiveRestore, BookOpen, Smartphone, Trash2, TriangleAlert } from 'lucide-vue-next'
import type { AnnotationHubItem } from '@bookorbit/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const props = defineProps<{
  annotation: AnnotationHubItem
  selected: boolean
  trashed: boolean
}>()

const emit = defineEmits<{
  toggleSelect: [id: number]
  jump: [annotation: AnnotationHubItem]
  trash: [id: number]
  restore: [id: number]
  purge: [id: number]
}>()

const isApproximate = computed(() => props.annotation.cfi == null && props.annotation.origin !== 'web')
const canJump = computed(() => props.annotation.jumpFileId != null && !props.trashed)

const styleLabel = computed(() => {
  const labels: Record<string, string> = {
    highlight: 'Highlight',
    underline: 'Underline',
    strikethrough: 'Strikethrough',
    squiggly: 'Squiggly',
    invert: 'Invert',
  }
  return labels[props.annotation.style] ?? props.annotation.style
})

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString()
}

function handleToggleSelect() {
  emit('toggleSelect', props.annotation.id)
}

function handleJump() {
  emit('jump', props.annotation)
}

function handleTrash() {
  emit('trash', props.annotation.id)
}

function handleRestore() {
  emit('restore', props.annotation.id)
}

function handlePurge() {
  emit('purge', props.annotation.id)
}
</script>

<template>
  <div
    class="rounded-lg border border-border bg-card p-3 flex gap-3 transition-colors"
    :class="selected ? 'ring-1 ring-primary border-primary/50' : 'hover:border-primary/30'"
  >
    <input
      type="checkbox"
      class="mt-1 h-4 w-4 shrink-0 accent-[var(--primary)] cursor-pointer"
      :checked="selected"
      aria-label="Select annotation"
      @change="handleToggleSelect"
    />
    <span class="mt-1 w-2.5 h-2.5 rounded-full shrink-0" :style="{ background: annotation.color }" />
    <div class="flex-1 min-w-0">
      <p class="text-sm leading-relaxed line-clamp-3">{{ annotation.text }}</p>
      <p v-if="annotation.note" class="text-xs text-muted-foreground italic mt-1 line-clamp-2">{{ annotation.note }}</p>
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1 mt-2 text-[11px] text-muted-foreground">
        <span class="font-medium text-foreground/80 truncate max-w-[16rem]">{{ annotation.bookTitle ?? 'Unknown book' }}</span>
        <span v-if="annotation.chapterTitle" class="truncate max-w-[12rem]">{{ annotation.chapterTitle }}</span>
        <span>{{ styleLabel }}</span>
        <span class="inline-flex items-center gap-1">
          <Smartphone v-if="annotation.origin === 'koreader'" :size="11" />
          {{ annotation.origin === 'koreader' ? 'KOReader' : annotation.origin === 'kobo' ? 'Kobo' : 'Web' }}
        </span>
        <span>{{ formatDate(annotation.createdAt) }}</span>
        <Tooltip v-if="isApproximate">
          <TooltipTrigger as-child>
            <TriangleAlert :size="11" class="text-amber-500" />
          </TooltipTrigger>
          <TooltipContent>Exact reader position unavailable for this device highlight</TooltipContent>
        </Tooltip>
      </div>
    </div>
    <div class="flex flex-col items-end gap-1 shrink-0">
      <Tooltip v-if="canJump">
        <TooltipTrigger as-child>
          <button
            type="button"
            class="flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-primary transition-colors"
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
              class="flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-primary transition-colors"
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
              class="flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-destructive transition-colors"
              @click="handlePurge"
            >
              <Trash2 :size="15" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Delete forever</TooltipContent>
        </Tooltip>
      </template>
      <Tooltip v-else>
        <TooltipTrigger as-child>
          <button
            type="button"
            class="flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-destructive transition-colors"
            @click="handleTrash"
          >
            <Trash2 :size="15" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Move to trash</TooltipContent>
      </Tooltip>
    </div>
  </div>
</template>
