<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { BookOpen, FolderPlus, Pencil, Trash2, X } from 'lucide-vue-next'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { DialogRoot, DialogContent, DialogPortal, DialogOverlay, DialogClose } from 'reka-ui'
import { useBookDetail } from '../composables/useBookDetail'
import { bookCoverStyle } from '../lib/book-cover'

const props = defineProps<{ bookId: number | null; open: boolean }>()
const emit = defineEmits<{
  'update:open': [value: boolean]
  action: [type: 'edit-metadata' | 'add-to-collection' | 'delete']
}>()

const router = useRouter()
const { detail, loading, fetch } = useBookDetail()

const coverLoaded = ref(false)
const coverFailed = ref(false)

watch(
  () => props.bookId,
  (id) => {
    if (id !== null) {
      coverLoaded.value = false
      coverFailed.value = false
      descriptionExpanded.value = false
      fetch(id)
    }
  },
  { immediate: true },
)

const coverStyle = computed(() => (detail.value ? bookCoverStyle(detail.value.title ?? String(detail.value.id)) : {}))

const seriesLine = computed(() => {
  if (!detail.value?.seriesName) return null
  const idx = detail.value.seriesIndex
  return idx != null ? `${detail.value.seriesName} #${idx % 1 === 0 ? Math.floor(idx) : idx}` : detail.value.seriesName
})

const authorLine = computed(() => detail.value?.authors.map((a) => a.name).join(', ') ?? null)

const descriptionExpanded = ref(false)
const coverLightboxOpen = ref(false)

const primaryFile = computed(() => detail.value?.files.find((f) => f.role === 'primary') ?? detail.value?.files[0] ?? null)

function openBook() {
  if (!primaryFile.value || !detail.value) return
  router.push({
    name: 'reader',
    params: { bookId: detail.value.id, fileId: primaryFile.value.id },
    query: { format: primaryFile.value.format ?? 'epub' },
  })
  emit('update:open', false)
}
</script>

<template>
  <Sheet :open="props.open" @update:open="emit('update:open', $event)">
    <SheetContent side="right" class="sm:max-w-[400px] p-0 overflow-hidden">
      <div class="flex flex-col h-full">
        <!-- Header: cover + title block -->
        <div class="p-5 pt-10 border-b shrink-0">
          <div v-if="loading" class="flex gap-4 items-start">
            <Skeleton class="w-24 rounded shrink-0" style="aspect-ratio: 2/3" />
            <div class="flex-1 space-y-2 pt-1">
              <Skeleton class="h-4 w-full" />
              <Skeleton class="h-3 w-3/4" />
              <Skeleton class="h-3 w-1/2" />
            </div>
          </div>

          <div v-else-if="detail" class="flex gap-4 items-start">
            <!-- Cover -->
            <div
              class="w-24 shrink-0 rounded overflow-hidden shadow-md cursor-zoom-in"
              style="aspect-ratio: 2/3"
              :style="coverLoaded ? {} : coverStyle"
              @click="coverLoaded && !coverFailed && (coverLightboxOpen = true)"
            >
              <img
                v-if="!coverFailed"
                :src="`/api/books/${detail.id}/cover`"
                class="w-full h-full object-cover transition-opacity duration-200"
                :class="coverLoaded ? 'opacity-100' : 'opacity-0'"
                :alt="detail.title ?? ''"
                @load="coverLoaded = true"
                @error="coverFailed = true"
              />
            </div>

            <!-- Info -->
            <div class="flex-1 min-w-0 pr-2">
              <SheetTitle class="text-sm font-bold leading-snug line-clamp-3">
                {{ detail.title ?? 'Untitled' }}
              </SheetTitle>
              <p v-if="detail.subtitle" class="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                {{ detail.subtitle }}
              </p>
              <p v-if="authorLine" class="text-xs text-foreground/80 mt-2">{{ authorLine }}</p>
              <p v-if="seriesLine" class="text-xs text-muted-foreground mt-0.5 italic">{{ seriesLine }}</p>
            </div>
          </div>
        </div>

        <!-- Body: scrollable meta + description -->
        <div class="flex-1 overflow-y-auto p-5 space-y-4">
          <template v-if="loading">
            <div class="flex gap-1.5">
              <Skeleton class="h-5 w-12 rounded" />
              <Skeleton class="h-5 w-16 rounded" />
              <Skeleton class="h-5 w-10 rounded" />
            </div>
            <Skeleton class="h-3 w-1/2" />
            <Skeleton class="h-32 w-full rounded" />
          </template>

          <template v-else-if="detail">
            <!-- Meta chips -->
            <div class="flex flex-wrap gap-1.5">
              <span
                v-for="file in detail.files"
                :key="file.id"
                class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-muted text-muted-foreground"
              >
                {{ file.format ?? '?' }}
              </span>
              <span v-if="detail.pageCount" class="text-[10px] font-semibold px-2 py-0.5 rounded bg-muted text-muted-foreground">
                {{ detail.pageCount }} pages
              </span>
              <span v-if="detail.publishedYear" class="text-[10px] font-semibold px-2 py-0.5 rounded bg-muted text-muted-foreground">
                {{ detail.publishedYear }}
              </span>
              <span v-if="detail.language" class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-muted text-muted-foreground">
                {{ detail.language }}
              </span>
            </div>

            <!-- Publisher -->
            <p v-if="detail.publisher" class="text-xs text-muted-foreground">
              {{ detail.publisher }}
            </p>

            <!-- Tags -->
            <div v-if="detail.tags.length" class="flex flex-wrap gap-1.5">
              <span v-for="tag in detail.tags" :key="tag" class="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                {{ tag }}
              </span>
            </div>

            <!-- Description -->
            <div class="border-t pt-4">
              <div v-if="detail.description">
                <p class="text-sm leading-relaxed text-foreground/80 transition-all" :class="descriptionExpanded ? '' : 'line-clamp-4'">
                  {{ detail.description }}
                </p>
                <button
                  class="text-xs text-muted-foreground hover:text-foreground mt-1.5 transition-colors"
                  @click="descriptionExpanded = !descriptionExpanded"
                >
                  {{ descriptionExpanded ? 'Show less' : 'Show more' }}
                </button>
              </div>
              <p v-else class="text-xs text-muted-foreground italic">No description available.</p>
            </div>
          </template>
        </div>

        <!-- Footer: actions -->
        <div class="p-4 border-t shrink-0 flex gap-2">
          <button
            class="flex flex-1 items-center justify-center gap-2 h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            :disabled="!primaryFile"
            @click="openBook"
          >
            <BookOpen class="size-4" />
            Read
          </button>
          <button
            class="flex items-center justify-center gap-1.5 h-9 px-3 rounded-md border border-input bg-background text-sm hover:bg-muted transition-colors"
            title="Edit Metadata"
            @click="emit('action', 'edit-metadata')"
          >
            <Pencil class="size-3.5" />
          </button>
          <button
            class="flex items-center justify-center gap-1.5 h-9 px-3 rounded-md border border-input bg-background text-sm hover:bg-muted transition-colors"
            title="Add to Collection"
            @click="emit('action', 'add-to-collection')"
          >
            <FolderPlus class="size-3.5" />
          </button>
          <button
            class="flex items-center justify-center h-9 px-3 rounded-md text-sm text-destructive hover:bg-destructive/10 transition-colors"
            title="Delete"
            @click="emit('action', 'delete')"
          >
            <Trash2 class="size-3.5" />
          </button>
        </div>
      </div>
    </SheetContent>
  </Sheet>

  <!-- Cover lightbox -->
  <DialogRoot :open="coverLightboxOpen" @update:open="coverLightboxOpen = $event">
    <DialogPortal>
      <DialogOverlay
        class="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
      />
      <DialogContent
        class="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 max-w-[90vw] max-h-[90vh] outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
      >
        <img
          v-if="detail"
          :src="`/api/books/${detail.id}/cover`"
          :alt="detail.title ?? ''"
          class="max-w-[90vw] max-h-[90vh] rounded-md shadow-2xl object-contain"
        />
        <DialogClose
          class="absolute -top-3 -right-3 p-1 rounded-full bg-background border border-border text-muted-foreground hover:text-foreground transition-colors"
        >
          <X class="size-4" />
        </DialogClose>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
