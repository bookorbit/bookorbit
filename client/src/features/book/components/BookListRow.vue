<script setup lang="ts">
import type { BookCard, BookFileRef } from '@projectx/types'
import { bookCoverStyle } from '../lib/book-cover'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { BookOpen, ExternalLink, FolderPlus, MoreHorizontal, PanelRight, Pencil, Trash2, TriangleAlert } from 'lucide-vue-next'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useCoverVersions } from '../composables/useCoverVersions'

const router = useRouter()

const props = defineProps<{ book: BookCard }>()

type BookActionType = 'quick-view' | 'edit-metadata' | 'add-to-collection' | 'delete'
const emit = defineEmits<{ action: [type: BookActionType] }>()

const coverStyle = computed(() => bookCoverStyle(props.book.title ?? String(props.book.id)))
const authorLine = computed(() => props.book.authors.join(', ') || null)
const seriesLine = computed(() => {
  if (!props.book.seriesName) return null
  const idx = props.book.seriesIndex
  return idx != null ? `${props.book.seriesName} #${idx % 1 === 0 ? Math.floor(idx) : idx}` : props.book.seriesName
})

const isMissing = computed(() => props.book.status === 'missing')
const primaryFile = computed(() => props.book.files.find((f) => f.role === 'primary') ?? props.book.files[0] ?? null)
const extraFiles = computed(() => (props.book.files.length > 1 ? props.book.files : []))

const coverLoaded = ref(false)
const coverFailed = ref(false)

const { coverUrl } = useCoverVersions()
const coverSrc = computed(() => coverUrl(props.book.id))

function openFile(file: BookFileRef) {
  router.push({
    name: 'reader',
    params: { bookId: props.book.id, fileId: file.id },
    query: { format: file.format ?? 'epub' },
  })
}
</script>

<template>
  <div
    class="flex items-center gap-3 py-2 px-2 rounded-md transition-colors"
    :class="[primaryFile && !isMissing ? 'cursor-pointer hover:bg-muted/50' : 'cursor-default', isMissing ? 'opacity-60 grayscale' : '']"
    @click="primaryFile && !isMissing && openFile(primaryFile)"
  >
    <!-- Cover -->
    <div class="h-16 w-12 rounded shrink-0 overflow-hidden relative" :style="coverLoaded ? {} : coverStyle">
      <img
        v-if="!coverFailed"
        :src="coverSrc"
        class="absolute inset-0 w-full h-full object-cover transition-opacity duration-200"
        :class="coverLoaded ? 'opacity-100' : 'opacity-0'"
        loading="lazy"
        :alt="book.title ?? ''"
        @load="coverLoaded = true"
        @error="coverFailed = true"
      />
    </div>

    <!-- Main info -->
    <div class="flex flex-col min-w-0 flex-1 gap-0.5">
      <span class="text-sm font-medium text-foreground truncate leading-snug">{{ book.title ?? '-' }}</span>
      <span v-if="authorLine" class="text-xs text-muted-foreground truncate">{{ authorLine }}</span>
      <span v-if="seriesLine" class="text-xs text-muted-foreground/70 truncate italic">{{ seriesLine }}</span>
    </div>

    <!-- Right badges + actions -->
    <div class="flex items-center gap-2 shrink-0" @click.stop>
      <div class="flex flex-col items-end gap-1">
        <span
          v-if="isMissing"
          class="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400"
        >
          <TriangleAlert class="size-3 shrink-0" />
          Missing
        </span>
        <button
          v-for="file in extraFiles"
          :key="file.id"
          class="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground hover:bg-muted/70 transition-colors"
          :class="file.role === 'primary' ? 'text-foreground' : 'text-muted-foreground'"
          :title="`Open as ${file.format?.toUpperCase() ?? 'unknown'}`"
          @click="openFile(file)"
        >
          {{ file.format ?? '?' }}
        </button>
      </div>

      <button
        class="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
        title="Quick view"
        @click="emit('action', 'quick-view')"
      >
        <PanelRight class="size-4" />
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <button class="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
            <MoreHorizontal class="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem @click="primaryFile && openFile(primaryFile)">
            <BookOpen class="size-4 mr-2" />
            Open
          </DropdownMenuItem>
          <DropdownMenuItem @click="router.push({ name: 'book-detail', params: { bookId: book.id } })">
            <ExternalLink class="size-4 mr-2" />
            Book Details
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem @click="emit('action', 'edit-metadata')">
            <Pencil class="size-4 mr-2" />
            Edit Metadata
          </DropdownMenuItem>
          <DropdownMenuItem @click="emit('action', 'add-to-collection')">
            <FolderPlus class="size-4 mr-2" />
            Add to Collection
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem class="text-destructive focus:text-destructive" @click="emit('action', 'delete')">
            <Trash2 class="size-4 mr-2" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </div>
</template>
