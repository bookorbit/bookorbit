<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { BookOpen, ExternalLink, FolderPlus, Pencil, RefreshCw, Send, Trash2 } from 'lucide-vue-next'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useRefreshMetadata } from '@/features/book/composables/useRefreshMetadata'
import { useBookRefreshFeedback } from '@/features/book/composables/useBookRefreshFeedback'
import { useRefreshingBooks } from '@/features/book/composables/useRefreshingBooks'
import { detectChangedColumns, mergeBookCardWithDetail } from '@/features/book/lib/book-card-mapper'
import SendBookDialog from '@/features/email/components/SendBookDialog.vue'
import type { BookCard } from '@bookorbit/types'

type BookActionType = 'quick-view' | 'add-to-collection' | 'delete'

const props = defineProps<{
  book: BookCard | null
  position: { x: number; y: number } | null
}>()

const emit = defineEmits<{
  action: [book: BookCard, type: BookActionType]
  'update:book': [updated: BookCard]
  close: []
}>()

const router = useRouter()
const { hasPermission } = usePermissions()
const { refreshWithFeedback, refreshing } = useRefreshMetadata()
const refreshFeedback = useBookRefreshFeedback()
const { isRefreshing } = useRefreshingBooks()

const menuRef = ref<HTMLElement | null>(null)
const menuSize = ref({ width: 180, height: 240 })
const showSendDialog = ref(false)
const anyRefreshing = computed(() => {
  if (!props.book) return refreshing.value
  return refreshing.value || isRefreshing(props.book.id)
})

const adjustedX = computed(() => {
  if (!props.position) return 0
  return Math.max(8, Math.min(props.position.x, window.innerWidth - menuSize.value.width - 8))
})

const adjustedY = computed(() => {
  if (!props.position) return 0
  return Math.max(8, Math.min(props.position.y, window.innerHeight - menuSize.value.height - 8))
})

function closeMenu(): void {
  emit('close')
}

async function measureMenu(): Promise<void> {
  await nextTick()
  if (!menuRef.value) return
  menuSize.value = {
    width: menuRef.value.offsetWidth,
    height: menuRef.value.offsetHeight,
  }
}

function handleDocumentClick(event: MouseEvent): void {
  if (!props.position) return
  const target = event.target as Node | null
  if (menuRef.value?.contains(target)) return
  closeMenu()
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && props.position) {
    event.preventDefault()
    closeMenu()
  }
}

function handleScroll(): void {
  if (props.position) closeMenu()
}

function emitAction(type: BookActionType): void {
  if (!props.book) return
  emit('action', props.book, type)
  closeMenu()
}

function openBookDetails(): void {
  if (!props.book) return
  router.push({ name: 'book-detail', params: { bookId: props.book.id } })
  closeMenu()
}

function openEditMetadata(): void {
  if (!props.book) return
  router.push({ name: 'book-detail', params: { bookId: props.book.id }, query: { tab: 'edit' } })
  closeMenu()
}

async function refreshMetadata(): Promise<void> {
  const currentBook = props.book
  if (!currentBook) return
  refreshFeedback.markRefreshing(currentBook.id)
  const updated = await refreshWithFeedback(currentBook.id)
  if (updated) {
    const merged = mergeBookCardWithDetail(currentBook, updated)
    refreshFeedback.markSuccess(currentBook.id, detectChangedColumns(currentBook, merged))
    emit('update:book', merged)
  } else {
    refreshFeedback.markFailed(currentBook.id)
  }
  closeMenu()
}

function openSendDialog(): void {
  showSendDialog.value = true
  closeMenu()
}

watch(
  () => props.position,
  (position) => {
    if (position) {
      void measureMenu()
    }
  },
)

onMounted(() => {
  document.addEventListener('click', handleDocumentClick)
  document.addEventListener('keydown', handleKeydown)
  window.addEventListener('scroll', handleScroll, true)
  window.addEventListener('resize', handleScroll)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleDocumentClick)
  document.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('scroll', handleScroll, true)
  window.removeEventListener('resize', handleScroll)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="book && position"
      ref="menuRef"
      class="fixed z-[100] min-w-[180px] rounded-md border border-border bg-popover p-1 shadow-md"
      :style="{ top: `${adjustedY}px`, left: `${adjustedX}px` }"
    >
      <button class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent" @click="emitAction('quick-view')">
        <BookOpen :size="14" />
        Quick View
      </button>
      <button class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent" @click="openBookDetails">
        <ExternalLink :size="14" />
        Book Details
      </button>
      <button
        v-if="hasPermission('library_edit_metadata')"
        class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
        @click="openEditMetadata"
      >
        <Pencil :size="14" />
        Edit Metadata
      </button>
      <button
        v-if="hasPermission('library_edit_metadata')"
        class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
        :disabled="anyRefreshing"
        @click="refreshMetadata"
      >
        <RefreshCw :size="14" :class="{ 'animate-spin': anyRefreshing }" />
        Refresh Metadata
      </button>
      <button class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent" @click="emitAction('add-to-collection')">
        <FolderPlus :size="14" />
        Add to Collection
      </button>
      <button
        v-if="hasPermission('email_send')"
        class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
        @click="openSendDialog"
      >
        <Send :size="14" />
        Send to Device
      </button>
      <button
        v-if="hasPermission('library_delete_books')"
        class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-destructive hover:bg-accent"
        @click="emitAction('delete')"
      >
        <Trash2 :size="14" />
        Delete
      </button>
    </div>
  </Teleport>

  <SendBookDialog v-if="book && showSendDialog" :book-ids="[book.id]" :open="showSendDialog" @update:open="showSendDialog = $event" />
</template>
