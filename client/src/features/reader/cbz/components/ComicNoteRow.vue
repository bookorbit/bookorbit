<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Ellipsis, Pencil, Trash2 } from '@lucide/vue'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { formatDate } from '@/i18n/formatters'
import type { ComicNote } from '../composables/useComicNotes'

const props = defineProps<{
  note: ComicNote
  thumbnailUrl: string
  current: boolean
}>()

const emit = defineEmits<{
  open: [note: ComicNote]
  edit: [note: ComicNote]
  delete: [note: ComicNote]
}>()

const { t } = useI18n()

const pageNumber = computed(() => props.note.page + 1)
const date = computed(() => {
  const at = new Date(props.note.annotation.highlightedAt)
  return Number.isNaN(at.getTime()) ? '' : formatDate(at, { month: 'short', day: 'numeric', year: 'numeric' })
})

function handleOpen() {
  emit('open', props.note)
}

// The dialog hands focus back to whatever held it when it opened, and the menu only refocuses its
// trigger on a timer, after the dialog has opened; so the row puts focus on the trigger itself first.
const menuTrigger = ref<HTMLButtonElement | null>(null)
let editAfterMenuCloses = false

function handleEdit() {
  editAfterMenuCloses = true
}

function handleMenuCloseAutoFocus(event: Event) {
  if (!editAfterMenuCloses) return
  editAfterMenuCloses = false
  event.preventDefault()
  menuTrigger.value?.focus()
  emit('edit', props.note)
}

function handleDelete() {
  emit('delete', props.note)
}
</script>

<template>
  <div
    class="group relative flex h-[68px] items-center gap-3 rounded-md ps-3 pe-1 transition-colors"
    :class="props.current ? 'bg-primary/10' : 'hover:bg-muted'"
    data-testid="comic-note-row"
  >
    <span aria-hidden="true" class="absolute inset-y-2 start-0 w-[3px] rounded-e-full" :style="{ background: props.note.annotation.color }" />
    <img
      :src="props.thumbnailUrl"
      alt=""
      loading="lazy"
      decoding="async"
      draggable="false"
      class="h-[52px] w-[34px] shrink-0 rounded-sm bg-muted object-cover ring-1 ring-border"
    />
    <button
      type="button"
      class="flex min-w-0 flex-1 flex-col self-stretch justify-center rounded-sm text-start focus-visible:outline-2 focus-visible:outline-primary"
      :aria-current="props.current ? 'page' : undefined"
      @click="handleOpen"
    >
      <span class="flex items-baseline gap-2 text-xs">
        <span class="font-semibold tabular-nums" :class="props.current ? 'text-primary' : 'text-foreground'">
          {{ t('reader.cbz.notes.page', { page: pageNumber }) }}
        </span>
        <span class="truncate text-[11px] text-muted-foreground">{{ date }}</span>
      </span>
      <span class="mt-0.5 line-clamp-2 break-words text-xs leading-snug text-foreground">{{ props.note.annotation.note }}</span>
    </button>
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <button
          ref="menuTrigger"
          type="button"
          class="viewer-btn size-7 focus-visible:outline-2 focus-visible:outline-primary"
          :aria-label="t('reader.cbz.notes.more', { page: pageNumber })"
        >
          <Ellipsis :size="15" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" class="z-[60]" @close-auto-focus="handleMenuCloseAutoFocus">
        <DropdownMenuItem @select="handleEdit">
          <Pencil />
          {{ t('reader.cbz.notes.edit') }}
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" @select="handleDelete">
          <Trash2 />
          {{ t('reader.cbz.notes.delete') }}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>
