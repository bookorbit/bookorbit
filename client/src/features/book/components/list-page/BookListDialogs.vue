<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import SelectionActionBar from '@/components/SelectionActionBar.vue'
import BookQuickView from '@/features/book/components/BookQuickView.vue'
import BulkEditMetadataDialog from '@/features/book/components/BulkEditMetadataDialog.vue'
import DeleteBookDialog from '@/features/book/components/DeleteBookDialog.vue'
import MetadataExportDialog from '@/features/book/components/MetadataExportDialog.vue'
import MoveToLibrarySheet from '@/features/book/components/MoveToLibrarySheet.vue'
import AddToCollectionSheet from '@/features/collection/components/AddToCollectionSheet.vue'
import SendBookDialog from '@/features/email/components/SendBookDialog.vue'
import type { BookListPage } from '@/features/book/composables/useBookListPage'

const MergeBooksSheet = defineAsyncComponent(() => import('@/features/book/components/merge/MergeBooksSheet.vue'))
const LinkBooksSheet = defineAsyncComponent(() => import('@/features/book/components/link/LinkBooksSheet.vue'))

/** The selection bar and every sheet and dialog a book listing opens from it or from a book's menu. */
defineProps<{
  page: BookListPage
  /** Offers "Remove from collection" in the selection bar. */
  inCollection?: boolean
}>()

const emit = defineEmits<{ removeFromCollection: [] }>()

function handleRemoveFromCollection() {
  emit('removeFromCollection')
}
</script>

<template>
  <BookQuickView
    :book-id="page.quickViewBookId"
    :open="page.quickViewOpen"
    @update:open="page.setQuickViewOpen"
    @action="page.handleQuickViewAction"
  />

  <SelectionActionBar
    :metadata-editable="page.canEditSelectionMetadata"
    :visible="page.selectionMode"
    :count="page.selectedCount"
    :in-flight="page.inFlight"
    :in-collection="inCollection"
    :merge="page.mergeSelection"
    :link="page.linkSelection"
    :linked-selected="page.selectionHasLinked"
    :other-editions="page.selectionOtherEditions"
    @send="page.openSendBook"
    @download="page.handleDownloadFiles"
    @export-metadata="page.openMetadataExport"
    @add-to-collection="page.openAddToCollection"
    @remove-from-collection="handleRemoveFromCollection"
    @edit="page.handleEditSelected"
    @edit-individually="page.handleEditIndividually"
    @refresh-metadata="page.handleBulkRefreshMetadata"
    @re-extract-cover="page.handleBulkReExtractCover"
    @embed-audio-cover="page.handleBulkEmbedAudioCover"
    @set-status="page.handleBulkSetStatus"
    @set-rating="page.handleBulkSetRating"
    @set-field="page.handleBulkSetField"
    @lock-metadata="page.handleBulkSetMetadataLock"
    @delete="page.handleDeleteSelected"
    @move-to-library="page.openMoveForSelection"
    @merge="page.openMergeForSelection"
    @link="page.openLinkForSelection"
    @exit="page.exitSelectionMode"
    @cancel-in-flight="page.cancelInFlight"
    @hide-in-flight="page.hideInFlight"
  />

  <MetadataExportDialog
    :open="page.metadataExportOpen"
    :view-type="page.viewType"
    :selected-book-ids="[...page.selectedIds]"
    :selected-count="page.selectedCount"
    :total-count="page.bookTotal"
    :sort="page.tableSort"
    :visible-columns="page.visibleExportColumns"
    default-scope="selected"
    @update:open="page.setMetadataExportOpen"
  />

  <AddToCollectionSheet
    :open="page.addToCollectionOpen"
    :selection-payload="{ bookIds: [...page.selectedIds] }"
    :selected-count="page.selectedCount"
    @update:open="page.setAddToCollectionOpen"
    @done="page.exitSelectionMode"
  />

  <MoveToLibrarySheet
    :open="page.moveToLibraryOpen"
    :selection-payload="page.movePayload"
    :selected-count="page.moveCount"
    @update:open="page.setMoveOpen"
    @moved="page.handleBooksMoved"
  />

  <BulkEditMetadataDialog
    :open="page.bulkEditOpen"
    :book-count="page.bulkEditCount"
    :submitting="page.bulkEditSubmitting"
    @update:open="page.setBulkEditOpen"
    @confirm="page.handleBulkEditConfirm"
  />

  <SendBookDialog
    :open="page.sendBookOpen"
    :selection-payload="{ bookIds: [...page.selectedIds] }"
    :selected-count="page.selectedCount"
    @update:open="page.setSendBookOpen"
    @sent="page.exitSelectionMode"
  />

  <DeleteBookDialog
    :open="page.deleteBookId !== null"
    :deleting="page.deletingBook"
    :linked="page.pendingDeleteLinked"
    :editions="page.deleteEditions"
    @confirm="page.confirmDelete"
    @cancel="page.cancelDelete"
  />

  <LinkBooksSheet
    v-if="page.linkBookIds.length > 0"
    :open="page.linkOpen"
    :book-ids="page.linkBookIds"
    :books="page.linkBooks"
    :seed-books="page.linkSeedBooks"
    @update:open="page.setLinkOpen"
    @linked="page.handleBooksLinked"
  />

  <MergeBooksSheet
    v-if="page.mergeBookIds.length > 0"
    :open="page.mergeOpen"
    :book-ids="page.mergeBookIds"
    @update:open="page.setMergeOpen"
    @link-instead="page.switchMergeToLink"
    @merged="page.handleBooksMerged"
  />
</template>
