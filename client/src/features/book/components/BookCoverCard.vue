<script setup lang="ts">
import type { BookCard, BookFileRef } from '@projectx/types'
import { bookCoverStyle } from '../lib/book-cover'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { BookOpen, FolderPlus, MoreHorizontal, PanelRight, Pencil, Trash2 } from 'lucide-vue-next'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

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

const primaryFile = computed(() => props.book.files.find((f) => f.role === 'primary') ?? props.book.files[0] ?? null)
const extraFiles = computed(() => props.book.files.filter((f) => f !== primaryFile.value))

const coverLoaded = ref(false)
const coverFailed = ref(false)

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
    class="group flex flex-col @container"
    :class="primaryFile ? 'cursor-pointer' : 'cursor-default opacity-60'"
    @click="primaryFile && openFile(primaryFile)"
  >
    <!-- Cover -->
    <div
      class="relative w-full rounded-sm overflow-hidden shadow-md group-hover:shadow-xl group-hover:scale-[1.02] transition-all duration-150"
      style="aspect-ratio: 2/3"
      :style="coverLoaded ? {} : coverStyle"
    >
      <img
        v-if="!coverFailed"
        :src="`/api/books/${book.id}/thumbnail`"
        class="absolute inset-0 w-full h-full object-cover transition-opacity duration-200"
        :class="coverLoaded ? 'opacity-100' : 'opacity-0'"
        loading="lazy"
        :alt="book.title ?? ''"
        @load="coverLoaded = true"
        @error="coverFailed = true"
      />

      <!-- Series badge -->
      <div v-if="seriesLine" class="absolute top-1.5 left-1.5 right-1.5 z-10">
        <span
          class="text-[8px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded bg-black/30 backdrop-blur-sm line-clamp-1"
          :style="{ color: coverStyle.color }"
        >
          {{ seriesLine }}
        </span>
      </div>

      <!-- Missing overlay -->
      <div v-if="book.status === 'missing'" class="absolute inset-0 bg-black/60 flex items-center justify-center z-10">
        <span class="text-[10px] font-semibold uppercase tracking-widest text-destructive-foreground bg-destructive px-2 py-0.5 rounded">
          Missing
        </span>
      </div>

      <!-- Title + author (no-cover fallback, always visible when cover absent) -->
      <div v-if="!coverLoaded" class="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/60 to-transparent">
        <p class="text-xs font-bold leading-tight line-clamp-3" :style="{ color: coverStyle.color }">
          {{ book.title ?? '-' }}
        </p>
        <p v-if="authorLine" class="text-[10px] mt-0.5 opacity-80 truncate" :style="{ color: coverStyle.color }">
          {{ authorLine }}
        </p>
      </div>

      <!-- Hover overlay -->
      <div
        class="absolute inset-0 flex flex-col p-2 bg-black/60 backdrop-blur-[1px] opacity-0 group-hover:opacity-100 transition-opacity duration-150"
        @click.stop
      >
        <!-- Center: primary action buttons -->
        <div class="flex-1 flex flex-col items-center justify-center gap-[18cqi]">
          <button
            v-if="primaryFile"
            class="p-[7cqi] rounded-full bg-primary/50 hover:bg-primary transition-colors text-white"
            title="Read"
            @click="openFile(primaryFile)"
          >
            <BookOpen class="size-[14cqi]" />
          </button>
          <button
            class="p-[7cqi] rounded-full bg-primary/70 hover:bg-primary transition-colors text-white"
            title="Quick view"
            @click="emit('action', 'quick-view')"
          >
            <PanelRight class="size-[14cqi]" />
          </button>
        </div>

        <!-- Bottom: title/author + kebab -->
        <div class="flex items-end justify-between gap-2">
          <div v-if="coverLoaded" class="min-w-0 flex-1">
            <p class="text-xs font-semibold text-white leading-tight line-clamp-2">{{ book.title ?? '-' }}</p>
            <p v-if="authorLine" class="text-[10px] text-white/70 truncate mt-0.5">{{ authorLine }}</p>
          </div>
          <div v-else class="flex-1" />

          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <button class="p-1.5 rounded-full bg-black/40 hover:bg-white/20 transition-colors text-white shrink-0">
                <MoreHorizontal class="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem v-if="primaryFile" @click="openFile(primaryFile)">
                <BookOpen class="size-4 mr-2" />
                {{ extraFiles.length > 0 ? `Open as ${primaryFile.format?.toUpperCase() ?? 'primary'}` : 'Open' }}
              </DropdownMenuItem>
              <DropdownMenuItem v-for="file in extraFiles" :key="file.id" @click="openFile(file)">
                <BookOpen class="size-4 mr-2" />
                Open as {{ file.format?.toUpperCase() ?? '?' }}
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
    </div>
  </div>
</template>
