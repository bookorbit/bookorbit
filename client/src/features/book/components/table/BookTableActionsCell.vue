<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { BookOpen, ExternalLink, FolderPlus, MoreHorizontal, Pencil, RefreshCw, Send, Trash2 } from '@lucide/vue'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useRefreshMetadata } from '@/features/book/composables/useRefreshMetadata'
import { useBookRefreshFeedback } from '@/features/book/composables/useBookRefreshFeedback'
import { useRefreshingBooks } from '@/features/book/composables/useRefreshingBooks'
import { detectChangedColumns, mergeBookCardWithDetail } from '@/features/book/lib/book-card-mapper'
import SendBookDialog from '@/features/email/components/SendBookDialog.vue'
import type { BookCard } from '@bookorbit/types'

const props = defineProps<{
  book: BookCard
}>()

type BookActionType = 'quick-view' | 'add-to-collection' | 'delete'
const emit = defineEmits<{
  action: [type: BookActionType]
  'update:book': [updated: BookCard]
}>()

const router = useRouter()

const { t } = useI18n()
const { hasPermission } = usePermissions()
const { refreshWithFeedback, refreshing } = useRefreshMetadata()
const refreshFeedback = useBookRefreshFeedback()
const { isRefreshing } = useRefreshingBooks()
const showSendDialog = ref(false)
const anyRefreshing = computed(() => refreshing.value || isRefreshing(props.book.id))

function handleAction(type: BookActionType) {
  emit('action', type)
}

async function handleRefresh() {
  refreshFeedback.markRefreshing(props.book.id)
  const updated = await refreshWithFeedback(props.book.id)
  if (updated) {
    const merged = mergeBookCardWithDetail(props.book, updated)
    refreshFeedback.markSuccess(props.book.id, detectChangedColumns(props.book, merged))
    emit('update:book', merged)
    return
  }
  refreshFeedback.markFailed(props.book.id)
}
</script>

<template>
  <div class="flex items-center gap-0.5">
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button variant="ghost" size="icon" class="h-7 w-7 rounded text-muted-foreground/60 hover:text-foreground">
          <MoreHorizontal :size="14" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" class="w-44">
        <DropdownMenuItem @click="handleAction('quick-view')">
          <BookOpen :size="13" class="mr-2" />
          {{ t('book.table.actions.quickView') }}
        </DropdownMenuItem>
        <DropdownMenuItem @click="router.push({ name: 'book-detail', params: { bookId: book.id } })">
          <ExternalLink :size="13" class="mr-2" />
          {{ t('book.table.actions.bookDetails') }}
        </DropdownMenuItem>
        <DropdownMenuSeparator v-if="hasPermission('library_edit_metadata')" />
        <DropdownMenuItem
          v-if="hasPermission('library_edit_metadata')"
          @click="router.push({ name: 'book-detail', params: { bookId: book.id }, query: { tab: 'edit' } })"
        >
          <Pencil :size="13" class="mr-2" />
          {{ t('book.table.actions.editMetadata') }}
        </DropdownMenuItem>
        <DropdownMenuItem v-if="hasPermission('library_edit_metadata')" :disabled="anyRefreshing" @click="handleRefresh">
          <RefreshCw :size="13" class="mr-2" :class="{ 'animate-spin': anyRefreshing }" />
          {{ t('book.table.actions.refreshMetadata') }}
        </DropdownMenuItem>
        <DropdownMenuItem v-if="hasPermission('library_edit_metadata')" @click="handleAction('add-to-collection')">
          <FolderPlus :size="13" class="mr-2" />
          {{ t('book.table.actions.addToCollection') }}
        </DropdownMenuItem>
        <DropdownMenuItem v-if="hasPermission('email_send')" @click="showSendDialog = true">
          <Send :size="13" class="mr-2" />
          {{ t('book.table.actions.sendToDevice') }}
        </DropdownMenuItem>
        <DropdownMenuSeparator v-if="hasPermission('library_delete_books')" />
        <DropdownMenuItem
          v-if="hasPermission('library_delete_books')"
          class="text-destructive focus:text-destructive"
          @click="handleAction('delete')"
        >
          <Trash2 :size="13" class="mr-2" />
          {{ t('common.delete') }}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>

  <SendBookDialog
    v-if="showSendDialog"
    :selection-payload="{ bookIds: [book.id] }"
    :selected-count="1"
    :open="showSendDialog"
    @update:open="showSendDialog = $event"
  />
</template>
