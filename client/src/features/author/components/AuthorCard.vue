<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AuthorSummary } from '@projectx/types'
import { BookCopy, Check, ExternalLink, Loader2, MoreHorizontal, RefreshCw, Trash2 } from 'lucide-vue-next'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { bookCoverStyle } from '@/features/book/lib/book-cover'

const props = defineProps<{
  author: AuthorSummary
  selectionMode?: boolean
  selected?: boolean
  canRefresh?: boolean
  canDelete?: boolean
  refreshing?: boolean
  deleting?: boolean
}>()

const emit = defineEmits<{
  open: [authorId: number]
  select: [event: MouseEvent]
  refresh: [authorId: number]
  delete: [authorId: number]
}>()

const initial = computed(() => props.author.name.trim().charAt(0).toUpperCase() || '?')
const fallbackStyle = computed(() => bookCoverStyle(props.author.name || String(props.author.id)))
const imageSrc = computed(() => props.author.imageUrl ?? undefined)
const hasImage = computed(() => Boolean(imageSrc.value) && !imageFailed.value)

const imageFailed = ref(false)
watch(
  () => props.author.imageUrl,
  () => {
    imageFailed.value = false
  },
)

function handleClick(event: MouseEvent) {
  if (props.selectionMode || event.metaKey || event.ctrlKey) {
    emit('select', event)
    return
  }
  emit('open', props.author.id)
}

function handleRefresh() {
  if (!props.canRefresh || props.refreshing) return
  emit('refresh', props.author.id)
}

function handleDelete() {
  if (!props.canDelete || props.deleting) return
  emit('delete', props.author.id)
}
</script>

<template>
  <div
    class="group flex flex-col @container"
    :class="[selectionMode ? 'select-none' : '', 'cursor-pointer']"
    @click="handleClick($event as MouseEvent)"
  >
    <div
      class="relative w-full rounded-sm overflow-hidden shadow-md transition-[box-shadow,transform,ring] duration-150 will-change-transform"
      :class="[selectionMode ? '' : 'group-hover:shadow-xl group-hover:scale-[1.02]', selected ? 'ring-2 ring-primary' : '']"
      style="aspect-ratio: 2/3"
      :style="hasImage ? undefined : fallbackStyle"
    >
      <img
        v-if="hasImage"
        :src="imageSrc"
        :alt="`${author.name} portrait`"
        class="absolute inset-0 h-full w-full object-cover"
        loading="lazy"
        decoding="async"
        fetchpriority="low"
        @error="imageFailed = true"
      />
      <div v-else class="absolute inset-0 flex items-center justify-center text-3xl font-semibold" :style="{ color: fallbackStyle.color }">
        {{ initial }}
      </div>

      <div v-if="!selectionMode" class="absolute left-1.5 top-1.5 z-10">
        <span class="inline-flex items-center gap-1 rounded border border-white/20 bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white">
          <BookCopy :size="11" />
          {{ author.bookCount.toLocaleString() }}
        </span>
      </div>

      <div v-if="selectionMode" class="absolute inset-0 z-30 pointer-events-none" :class="selected ? 'bg-primary/20' : ''">
        <div
          class="absolute top-1.5 left-1.5 h-5 w-5 rounded flex items-center justify-center transition-colors"
          :class="selected ? 'bg-primary' : 'bg-black/40 border border-white/50'"
        >
          <Check v-if="selected" class="text-primary-foreground" :size="12" />
        </div>
      </div>

      <div
        class="absolute inset-x-0 bottom-0 z-10 p-2"
        :class="hasImage ? 'bg-linear-to-t from-black/80 via-black/35 to-transparent' : 'bg-linear-to-t from-black/65 via-black/30 to-transparent'"
      >
        <div class="flex items-end justify-between gap-2">
          <div class="min-w-0">
            <h3 class="line-clamp-2 text-xs leading-tight" :style="hasImage ? undefined : { color: fallbackStyle.color }">
              {{ author.name }}
            </h3>
          </div>

          <DropdownMenu v-if="!selectionMode">
            <DropdownMenuTrigger as-child>
              <button
                class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-black/35 text-white/90 transition-colors hover:bg-black/55 hover:text-white"
                @click.stop
              >
                <MoreHorizontal :size="14" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem @click="emit('open', author.id)">
                <ExternalLink class="mr-2 h-4 w-4" />
                View Author Details
              </DropdownMenuItem>
              <DropdownMenuItem :disabled="!canRefresh || refreshing" @click="handleRefresh">
                <Loader2 v-if="refreshing" class="mr-2 h-4 w-4 animate-spin" />
                <RefreshCw v-else class="mr-2 h-4 w-4" />
                Refresh Metadata
              </DropdownMenuItem>
              <DropdownMenuItem
                :disabled="!canDelete || deleting"
                :class="canDelete ? 'text-destructive focus:text-destructive' : ''"
                @click="handleDelete"
              >
                <Loader2 v-if="deleting" class="mr-2 h-4 w-4 animate-spin" />
                <Trash2 v-else class="mr-2 h-4 w-4" />
                Delete Author
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Transition name="fade">
        <div v-if="refreshing" class="absolute inset-0 z-40 flex items-center justify-center bg-black/50">
          <Loader2 class="size-[32cqi] animate-spin text-white drop-shadow-lg" />
        </div>
      </Transition>
    </div>
  </div>
</template>
