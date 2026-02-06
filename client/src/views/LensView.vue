<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Settings2, Trash2 } from 'lucide-vue-next'
import BookCoverCard from '@/features/book/components/BookCoverCard.vue'
import BookListRow from '@/features/book/components/BookListRow.vue'
import BookQuickView from '@/features/book/components/BookQuickView.vue'
import AppHeader from '@/components/AppHeader.vue'
import ViewHeader from '@/components/ViewHeader.vue'
import AppSidebar from '@/components/AppSidebar.vue'
import LensEditorPanel from '@/features/lens/components/LensEditorPanel.vue'
import SelectionActionBar from '@/components/SelectionActionBar.vue'
import AddToCollectionSheet from '@/features/collection/components/AddToCollectionSheet.vue'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { useLens } from '@/features/lens/composables/useLens'
import { useLenses } from '@/features/lens/composables/useLenses'
import { useDisplaySettings } from '@/composables/useDisplaySettings'
import { useBookSelection } from '@/features/book/composables/useBookSelection'
import { BACKGROUND_OPTIONS, useThemeStore } from '@/stores/theme'
import { FIELD_LABELS, ruleToLabel } from '@/features/book/lib/filter-labels'
import type { BookCard, GroupRule } from '@projectx/types'

const route = useRoute()
const router = useRouter()
const themeStore = useThemeStore()
const backgroundClass = computed(() => BACKGROUND_OPTIONS.find((b) => b.id === themeStore.background)?.cssClass ?? '')
const { coverSize, gridGap, viewMode } = useDisplaySettings()

const lensId = computed(() => Number(route.params.id))

const { items: books, total, loading, hasMore, load } = useLens(lensId)
const { lenses, fetchLenses, deleteLens } = useLenses()

function collectRuleChips(node: GroupRule): string[] {
  const chips: string[] = []
  for (const r of node.rules) {
    if (r.type === 'rule') chips.push(ruleToLabel(r))
    else chips.push(...collectRuleChips(r as GroupRule))
  }
  return chips
}

const lens = computed(() => lenses.value.find((l) => l.id === lensId.value))

const ruleChips = computed<string[]>(() => {
  const filter = lens.value?.filter
  if (!filter) return []
  return collectRuleChips(filter)
})

const sortChip = computed(() => {
  const s = lens.value?.defaultSort?.[0]
  if (!s) return null
  const fieldLabel = FIELD_LABELS[s.field as keyof typeof FIELD_LABELS] ?? s.field
  return `${fieldLabel} ${s.dir === 'asc' ? '↑' : '↓'}`
})

const joinLabel = computed(() => lens.value?.filter?.join ?? 'AND')

const { selectionMode, selectedIds, selectedCount, enterSelectionMode, exitSelectionMode, toggleBook, isSelected } = useBookSelection()

function toggleSelectionMode() {
  if (selectionMode.value) exitSelectionMode()
  else enterSelectionMode()
}

const addToCollectionOpen = ref(false)

type BookActionType = 'quick-view' | 'edit-metadata' | 'add-to-collection' | 'delete'

const quickViewBookId = ref<number | null>(null)
const quickViewOpen = ref(false)

function handleBookAction(book: BookCard, action: BookActionType) {
  if (action === 'quick-view') {
    quickViewBookId.value = book.id
    quickViewOpen.value = true
    return
  }
  if (action === 'add-to-collection') {
    if (!selectionMode.value) {
      enterSelectionMode()
      toggleBook(book.id)
    }
    addToCollectionOpen.value = true
    return
  }
}

const editorOpen = ref(false)
const confirmDelete = ref(false)
const deleting = ref(false)

async function handleDelete() {
  if (!confirmDelete.value) {
    confirmDelete.value = true
    return
  }
  deleting.value = true
  try {
    await deleteLens(lensId.value)
    router.push({ name: 'home' })
  } finally {
    deleting.value = false
    confirmDelete.value = false
  }
}

function onSaved() {
  load(true)
}

const sentinel = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

function checkSentinel() {
  if (!hasMore.value || loading.value) return
  const el = sentinel.value
  if (!el) return
  if (el.getBoundingClientRect().top < window.innerHeight + 300) load()
}

onMounted(async () => {
  await fetchLenses()
  if (!lens.value) {
    router.push({ name: 'home' })
    return
  }
  load(true)
  observer = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting && !loading.value) load()
    },
    { rootMargin: '300px' },
  )
  if (sentinel.value) observer.observe(sentinel.value)
})

onUnmounted(() => observer?.disconnect())

watch(lensId, () => load(true))
watch(loading, (isLoading) => {
  if (!isLoading) checkSentinel()
})
</script>

<template>
  <LensEditorPanel :open="editorOpen" :lens="lens" @close="editorOpen = false" @saved="onSaved" />

  <BookQuickView
    :book-id="quickViewBookId"
    :open="quickViewOpen"
    @update:open="quickViewOpen = $event"
    @action="quickViewBookId !== null && handleBookAction({ id: quickViewBookId } as BookCard, $event)"
  />

  <SelectionActionBar
    :visible="selectionMode"
    :count="selectedCount"
    @add-to-collection="addToCollectionOpen = true"
    @delete="() => {}"
    @exit="exitSelectionMode"
  />

  <AddToCollectionSheet
    :open="addToCollectionOpen"
    :book-ids="[...selectedIds]"
    @update:open="addToCollectionOpen = $event"
    @added="exitSelectionMode"
  />

  <SidebarProvider>
    <AppSidebar />

    <SidebarInset class="flex flex-col min-h-screen glow-wrapper">
      <AppHeader />
      <ViewHeader
        :title="lens?.name ?? 'Lens'"
        :icon="lens?.icon ?? undefined"
        :total="total"
        :loaded="books.length"
        v-model:coverSize="coverSize"
        v-model:gridGap="gridGap"
        v-model:viewMode="viewMode"
        :selection-mode="selectionMode"
        @toggle-selection="toggleSelectionMode"
      >
        <template #actions>
          <button
            @click="editorOpen = true; confirmDelete = false"
            class="hidden md:flex items-center gap-1.5 h-8 px-3 rounded-md border border-input text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Settings2 :size="13" />
            <span>Edit</span>
          </button>
          <button
            @click="handleDelete"
            :disabled="deleting"
            class="hidden md:flex items-center gap-1.5 h-8 px-3 rounded-md border text-sm transition-colors"
            :class="
              confirmDelete
                ? 'border-destructive text-destructive bg-destructive/10 hover:bg-destructive/20'
                : 'border-input text-muted-foreground hover:text-destructive hover:border-destructive'
            "
          >
            <Trash2 :size="13" />
            <span>{{ confirmDelete ? 'Confirm?' : 'Delete' }}</span>
          </button>
        </template>
      </ViewHeader>

      <main class="flex-1 overflow-y-auto px-4 py-4" :class="backgroundClass">
        <!-- Rule chips -->
        <div v-if="ruleChips.length > 0 || sortChip" class="flex flex-wrap items-center gap-1.5 mb-4 cursor-pointer" @click="editorOpen = true">
          <template v-if="ruleChips.length > 0">
            <span
              v-for="(chip, i) in ruleChips"
              :key="i"
              class="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-primary/8 border border-primary/20 text-primary font-medium hover:bg-primary/15 transition-colors"
            >
              {{ chip }}
            </span>
            <span v-if="ruleChips.length > 1" class="text-[10px] text-muted-foreground px-1"> ({{ joinLabel }}) </span>
          </template>
          <span
            v-if="sortChip"
            class="text-xs px-2.5 py-1 rounded-full bg-muted border border-border text-muted-foreground hover:bg-muted/80 transition-colors"
          >
            Sort: {{ sortChip }}
          </span>
        </div>

        <!-- Empty state: no rules configured -->
        <div v-if="!loading && !lens?.filter && books.length === 0" class="flex flex-col items-center justify-center py-24 gap-4 text-center">
          <div class="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
            <Settings2 :size="28" class="text-muted-foreground/50" />
          </div>
          <div class="flex flex-col gap-1">
            <p class="text-sm font-medium text-foreground">No rules configured</p>
            <p class="text-xs text-muted-foreground max-w-xs">
              Open the editor to define which books appear in this lens using filters and sort rules.
            </p>
          </div>
          <button
            @click="editorOpen = true"
            class="h-9 px-5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Configure Lens
          </button>
        </div>

        <!-- Empty state: rules set but no matches -->
        <div v-else-if="!loading && books.length === 0 && lens?.filter" class="flex flex-col items-center justify-center py-24 gap-3 text-center">
          <p class="text-sm font-medium text-foreground">No books match this lens</p>
          <p class="text-xs text-muted-foreground">Try adjusting the filter rules.</p>
          <button @click="editorOpen = true" class="text-xs text-primary hover:underline">Edit Lens</button>
        </div>

        <!-- Grid view -->
        <div
          v-if="viewMode === 'grid' && books.length > 0"
          class="grid"
          :style="{ gridTemplateColumns: `repeat(auto-fill, minmax(${coverSize}px, 1fr))`, gap: `${gridGap}px` }"
        >
          <BookCoverCard
            v-for="book in books"
            :key="book.id"
            :book="book"
            :selection-mode="selectionMode"
            :selected="isSelected(book.id)"
            @select="toggleBook(book.id)"
          />
        </div>

        <!-- List view -->
        <div v-else-if="viewMode === 'list' && books.length > 0" class="flex flex-col divide-y divide-border">
          <BookListRow
            v-for="book in books"
            :key="book.id"
            :book="book"
            :selection-mode="selectionMode"
            :selected="isSelected(book.id)"
            @select="toggleBook(book.id)"
            @action="handleBookAction(book, $event)"
          />
        </div>

        <div ref="sentinel" class="h-8 mt-4 flex items-center justify-center">
          <span v-if="loading" class="text-xs text-muted-foreground">Loading...</span>
          <span v-else-if="!hasMore && books.length > 0" class="text-xs text-muted-foreground"> All {{ total.toLocaleString() }} books loaded </span>
        </div>
      </main>
    </SidebarInset>
  </SidebarProvider>
</template>
