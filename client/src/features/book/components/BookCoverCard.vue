<script setup lang="ts">
import type { BookCard, BookFileRef } from '@projectx/types'
import { FORMAT_TO_GROUP } from '@projectx/types'
import { bookCoverStyle } from '../lib/book-cover'
import { getFormatColor } from '../lib/format-colors'
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  BookOpen,
  Check,
  ExternalLink,
  FolderPlus,
  Image,
  Loader2,
  MoreHorizontal,
  PanelRight,
  Pencil,
  RefreshCw,
  Send,
  Trash2,
  TriangleAlert,
} from 'lucide-vue-next'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useCoverVersions } from '../composables/useCoverVersions'
import { useRefreshMetadata } from '../composables/useRefreshMetadata'
import { useRefreshingBooks } from '../composables/useRefreshingBooks'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useDisplaySettings } from '@/composables/useDisplaySettings'
import SendBookDialog from '@/features/email/components/SendBookDialog.vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const router = useRouter()

const props = defineProps<{
  book: BookCard
  selectionMode?: boolean
  selected?: boolean
}>()

type BookActionType = 'quick-view' | 'edit-metadata' | 'add-to-collection' | 'delete'
const emit = defineEmits<{
  action: [type: BookActionType]
  select: [event: MouseEvent]
}>()

const coverStyle = computed(() => bookCoverStyle(props.book.title ?? String(props.book.id)))
const authorLine = computed(() => props.book.authors.join(', ') || null)
const seriesLine = computed(() => {
  if (!props.book.seriesName) return null
  const idx = props.book.seriesIndex
  return idx != null ? `${props.book.seriesName} #${idx % 1 === 0 ? Math.floor(idx) : idx}` : props.book.seriesName
})

const readableFiles = computed(() => props.book.files.filter((f) => f.format && f.format in FORMAT_TO_GROUP))
const primaryFile = computed(() => readableFiles.value.find((f) => f.role === 'primary') ?? readableFiles.value[0] ?? null)
const extraFiles = computed(() => readableFiles.value.filter((f) => f !== primaryFile.value))

const { coverUrl, bumpVersion } = useCoverVersions()
const coverSrc = computed(() => coverUrl(props.book.id))

const { refreshing, refreshWithFeedback } = useRefreshMetadata()
const { isRefreshing } = useRefreshingBooks()
const anyRefreshing = computed(() => refreshing.value || isRefreshing(props.book.id))
const reExtractingCover = ref(false)

async function reExtractCover() {
  if (reExtractingCover.value) return
  reExtractingCover.value = true
  try {
    await fetch(`/api/v1/books/${props.book.id}/re-extract-cover`, { method: 'POST' })
    bumpVersion(props.book.id)
  } finally {
    reExtractingCover.value = false
  }
}
const { hasPermission } = usePermissions()
const { cardOverlays } = useDisplaySettings()
const showSendDialog = ref(false)

const showSeriesOverlay = computed(() => cardOverlays.value.includes('series') && seriesLine.value != null)
const hasProgress = computed(() => props.book.readingProgress != null && props.book.readingProgress > 0)
const showProgressBar = computed(() => cardOverlays.value.includes('progress-bar') && hasProgress.value)
const showProgressPill = computed(() => cardOverlays.value.includes('progress-pill') && hasProgress.value)
const showFormatOverlay = computed(() => cardOverlays.value.includes('format') && primaryFile.value?.format != null)
const showRatingOverlay = computed(() => cardOverlays.value.includes('rating') && props.book.rating != null)
const showNewOverlay = computed(() => {
  if (!cardOverlays.value.includes('new')) return false
  const addedAt = new Date(props.book.addedAt)
  return Date.now() - addedAt.getTime() < 14 * 24 * 60 * 60 * 1000
})

const coverLoaded = ref(false)
const coverFailed = ref(false)
const isMissing = computed(() => props.book.status === 'missing')

watch(coverSrc, () => {
  coverLoaded.value = false
  coverFailed.value = false
})

function openFile(file: BookFileRef) {
  router.push({
    name: 'reader',
    params: { bookId: props.book.id, fileId: file.id },
    query: { format: file.format ?? 'epub' },
  })
}

function handleCardClick(event: MouseEvent) {
  if ((event.target as Element).closest('button')) return
  if (props.selectionMode) {
    emit('select', event)
    return
  }
  if (primaryFile.value && !isMissing.value) openFile(primaryFile.value)
}
</script>

<template>
  <div
    class="group flex flex-col @container"
    :class="[selectionMode || (primaryFile && !isMissing) ? 'cursor-pointer' : 'cursor-default', selectionMode ? 'select-none' : '']"
    @click="handleCardClick"
  >
    <!-- Cover -->
    <div
      class="relative w-full rounded-sm overflow-hidden shadow-md transition-all duration-150"
      :class="[
        isMissing ? 'ring-2 ring-amber-500' : selectionMode ? '' : 'group-hover:shadow-xl group-hover:scale-[1.02]',
        selected ? 'ring-2 ring-primary' : '',
      ]"
      style="aspect-ratio: 2/3"
      :style="coverLoaded ? {} : coverStyle"
    >
      <img
        v-if="!coverFailed"
        :src="coverSrc"
        class="absolute inset-0 w-full h-full object-cover transition-opacity duration-200"
        :class="coverLoaded ? (isMissing ? 'opacity-100 brightness-50' : 'opacity-100') : 'opacity-0'"
        loading="lazy"
        :alt="book.title ?? ''"
        @load="coverLoaded = true"
        @error="coverFailed = true"
      />

      <!-- Series badge -->
      <div v-if="showSeriesOverlay" class="absolute top-1.5 left-1.5 right-1.5 z-10 pointer-events-none">
        <span
          class="text-[8px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded bg-black/30 backdrop-blur-sm line-clamp-1"
          :style="{ color: coverStyle.color }"
        >
          {{ seriesLine }}
        </span>
      </div>

      <!-- "New" dot - top-right accent indicator -->
      <div v-if="showNewOverlay && !isMissing" class="absolute top-1.5 right-1.5 z-10 size-2 rounded-full bg-primary shadow-sm pointer-events-none" />

      <!-- Bottom-left overlays: rating dots + progress pill -->
      <div
        v-if="(showRatingOverlay || showProgressPill) && !selectionMode"
        class="absolute bottom-1.5 left-1.5 z-10 flex flex-col gap-0.5 items-start pointer-events-none"
      >
        <div v-if="showRatingOverlay" class="flex gap-[3px]">
          <span v-for="i in 5" :key="i" class="size-[5px] rounded-full" :class="i <= Math.round(book.rating!) ? 'bg-white/90' : 'bg-white/20'" />
        </div>
        <div v-if="showProgressPill">
          <span
            v-if="book.readingProgress === 100"
            class="flex items-center gap-0.5 text-[8px] font-semibold px-1.5 py-0.5 rounded bg-green-500/70 text-white backdrop-blur-sm"
          >
            <Check :size="8" />
          </span>
          <span v-else class="text-[9px] font-bold px-1.5 py-0.5 rounded bg-black/30 backdrop-blur-sm" :style="{ color: coverStyle.color }">
            {{ Math.floor(book.readingProgress!) }}%
          </span>
        </div>
      </div>

      <!-- Format badge - bottom-right -->
      <div
        v-if="showFormatOverlay && !selectionMode"
        class="absolute bottom-1.5 right-1.5 z-10 group-hover:opacity-0 transition-opacity duration-150 pointer-events-none"
      >
        <span
          class="text-[8px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded text-white"
          :style="{ backgroundColor: getFormatColor(primaryFile!.format!) + 'cc' }"
        >
          {{ primaryFile!.format!.toUpperCase() }}
        </span>
      </div>

      <!-- Reading progress bar - bottom edge -->
      <div
        v-if="showProgressBar && !selectionMode"
        class="absolute bottom-0 left-0 z-10 h-[3px] transition-all duration-300"
        :class="book.readingProgress === 100 ? 'bg-green-500/80' : 'bg-primary/70'"
        :style="{ width: `${book.readingProgress}%` }"
      />

      <!-- Selection checkbox overlay -->
      <div v-if="selectionMode" class="absolute inset-0 z-30 pointer-events-none" :class="selected ? 'bg-primary/20' : ''">
        <div
          class="absolute top-1.5 left-1.5 h-5 w-5 rounded flex items-center justify-center transition-colors"
          :class="selected ? 'bg-primary' : 'bg-black/40 border border-white/50'"
        >
          <Check v-if="selected" class="text-primary-foreground" :size="12" />
        </div>
      </div>

      <!-- Missing badge -->
      <div v-if="isMissing" class="absolute top-1.5 right-1.5 z-20">
        <span
          class="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded bg-amber-500/90 text-white backdrop-blur-sm"
        >
          <TriangleAlert class="size-2.5 shrink-0" />
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

      <!-- Refresh spinner overlay -->
      <Transition name="fade">
        <div v-if="anyRefreshing" class="absolute inset-0 z-40 flex items-center justify-center bg-black/30 backdrop-blur-[1.5px]">
          <Loader2 class="size-[32cqi] animate-spin text-white drop-shadow-lg" />
        </div>
      </Transition>

      <!-- Hover overlay -->
      <div
        v-if="!selectionMode"
        class="absolute inset-0 flex flex-col p-2 bg-black/60 backdrop-blur-[1px] opacity-0 group-hover:opacity-100 transition-opacity duration-150"
        @click.stop
      >
        <!-- Center: primary action buttons -->
        <div class="flex-1 flex flex-col items-center justify-center gap-[18cqi]">
          <Tooltip>
            <TooltipTrigger as-child>
              <button
                v-if="primaryFile && !isMissing"
                class="p-[7cqi] rounded-full bg-primary/50 hover:bg-primary transition-colors text-white"
                @click="openFile(primaryFile)"
              >
                <BookOpen class="size-[14cqi]" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Read</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <button class="p-[7cqi] rounded-full bg-primary/70 hover:bg-primary transition-colors text-white" @click="emit('action', 'quick-view')">
                <PanelRight class="size-[14cqi]" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Quick view</TooltipContent>
          </Tooltip>
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
              <DropdownMenuItem @click="router.push({ name: 'book-detail', params: { bookId: book.id } })">
                <ExternalLink class="size-4 mr-2" />
                Book Details
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem @click="router.push({ name: 'book-edit', params: { bookId: book.id } })">
                <Pencil class="size-4 mr-2" />
                Edit Metadata
              </DropdownMenuItem>
              <DropdownMenuItem :disabled="anyRefreshing" @click="refreshWithFeedback(book.id)">
                <Loader2 v-if="anyRefreshing" class="size-4 mr-2 animate-spin" />
                <RefreshCw v-else class="size-4 mr-2" />
                Refresh Metadata
              </DropdownMenuItem>
              <DropdownMenuItem v-if="hasPermission('library_edit_metadata')" :disabled="reExtractingCover" @click="reExtractCover()">
                <Loader2 v-if="reExtractingCover" class="size-4 mr-2 animate-spin" />
                <Image v-else class="size-4 mr-2" />
                Regenerate Cover
              </DropdownMenuItem>
              <DropdownMenuItem @click="emit('action', 'add-to-collection')">
                <FolderPlus class="size-4 mr-2" />
                Add to Collection
              </DropdownMenuItem>
              <DropdownMenuItem v-if="hasPermission('email_send')" @click="showSendDialog = true">
                <Send class="size-4 mr-2" />
                Send via Email
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

  <SendBookDialog
    v-if="showSendDialog"
    :open="showSendDialog"
    :book-ids="[book.id]"
    :book-files="book.files"
    :book-title="book.title ?? undefined"
    @update:open="showSendDialog = $event"
  />
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
