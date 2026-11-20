<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { formatNumber } from '@/i18n/formatters'
import { AlertTriangle, FileSpreadsheet, FolderOpen, Pencil, Trash2 } from '@lucide/vue'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import EntityNotFound from '@/components/EntityNotFound.vue'
import BrowseHeader from '@/components/browse-header/BrowseHeader.vue'
import BrowsePageMenu from '@/components/browse-header/BrowsePageMenu.vue'
import { outlineButton } from '@/components/browse-header/browse-header'
import BookListContent from '@/features/book/components/list-page/BookListContent.vue'
import BookListDialogs from '@/features/book/components/list-page/BookListDialogs.vue'
import BookListToolbar from '@/features/book/components/list-page/BookListToolbar.vue'
import { useBookListPage } from '@/features/book/composables/useBookListPage'
import { COLLECTION_DEFAULT_SORT } from '@/features/book/lib/sort-defaults'
import EditCollectionDialog from '@/features/collection/components/EditCollectionDialog.vue'
import { useCollections } from '@/features/collection/composables/useCollections'
import { canMutateCollection } from '@/features/collection/lib/collection-access'
import { usePageTitle } from '@/composables/usePageTitle'
import { cn } from '@/lib/utils'
import { normalizeCoverAspectRatio, type CoverAspectRatio } from '@bookorbit/types'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const collectionId = shallowRef(Number(route.params.id))
const {
  collections,
  loaded: collectionsLoaded,
  error: collectionsError,
  fetchCollections,
  removeBooksFromCollection,
  onBookMembershipChanged,
  deleteCollection,
} = useCollections()
const collectionNotFound = ref(false)
const collection = computed(() => collections.value.find((c) => c.id === collectionId.value))
const coverAspectRatio = computed<CoverAspectRatio>(() => normalizeCoverAspectRatio(collection.value?.coverAspectRatio))
const isCollectionOwner = computed(() => canMutateCollection(collection.value))

const page = useBookListPage({
  viewType: 'collection',
  scopeId: collectionId,
  listEndpoint: (id) => `/api/v1/collections/${id}/books/query`,
  bucketsEndpoint: (id) => `/api/v1/collections/${id}/books/jump-buckets`,
  defaultSort: COLLECTION_DEFAULT_SORT,
  initialSort: COLLECTION_DEFAULT_SORT,
  collapseScope: (id) => ({ collectionId: id }),
  coverAspectRatio,
  backupFilePrefix: 'collection',
})

let active = true
let booksNeedReload = false

onBookMembershipChanged((id) => {
  if (id !== collectionId.value) return
  if (active) page.reload()
  else booksNeedReload = true
})

onActivated(() => {
  active = true
  if (!booksNeedReload) return
  booksNeedReload = false
  page.reload()
})

onDeactivated(() => {
  active = false
})

const pageTitle = computed(() => {
  if (collection.value?.name) return t('views.collection.pageTitle', { name: collection.value.name })
  return Number.isFinite(collectionId.value) ? t('views.collection.pageTitleWithId', { id: collectionId.value }) : t('views.collection.title')
})
usePageTitle(pageTitle)

const collectionLoadError = computed(() => collectionsError.value ?? page.booksError)

const editCollectionOpen = ref(false)
let removingInProgress = false

async function handleRemoveFromCollection() {
  if (!isCollectionOwner.value || removingInProgress || !collectionId.value || page.selectedIds.size === 0) return
  removingInProgress = true
  try {
    const ids = [...page.selectedIds]
    await removeBooksFromCollection(collectionId.value, { bookIds: ids })
    page.exitSelectionMode()
    toast.success(t('views.collection.toast.removed', { count: ids.length }))
  } catch {
    toast.error(t('views.collection.toast.removeFailed'))
  } finally {
    removingInProgress = false
  }
}

function handleCollectionDeleted() {
  editCollectionOpen.value = false
}

function openCollectionEditor() {
  editCollectionOpen.value = true
}

function closeCollectionEditor() {
  editCollectionOpen.value = false
}

const hasPageMenu = computed(() => (isCollectionOwner.value && collection.value !== undefined) || page.canExport)

interface HeaderFact {
  key: string
  text: string
}

const headerFacts = computed<HeaderFact[]>(() => {
  const facts: HeaderFact[] = []
  const count = page.countFact(collection.value?.bookCount)
  if (count) facts.push({ key: 'count', text: count })
  const description = collection.value?.description?.trim()
  if (description) facts.push({ key: 'description', text: description })
  return facts
})

const foldedCount = computed(() => {
  const count = collection.value?.bookCount
  return typeof count === 'number' ? formatNumber(count) : undefined
})

const confirmDeleteOpen = ref(false)
const deletingCollection = ref(false)

function requestDelete() {
  confirmDeleteOpen.value = true
}

function cancelCollectionDelete() {
  confirmDeleteOpen.value = false
}

async function handleDeleteCollection() {
  const current = collection.value
  if (!current) return
  deletingCollection.value = true
  try {
    await deleteCollection(current.id)
    toast.success(t('collection.editDialog.deleted', { name: current.name }))
    void router.replace({ name: 'dashboard' })
  } catch {
    toast.error(t('collection.editDialog.deleteFailed'))
  } finally {
    deletingCollection.value = false
    confirmDeleteOpen.value = false
  }
}

onMounted(async () => {
  await retryCollectionLoad()
})

async function retryCollectionLoad() {
  collectionNotFound.value = false
  await fetchCollections()
  if (collectionsError.value) return
  if (!collection.value && collectionsLoaded.value) {
    collectionNotFound.value = true
    return
  }
  if (collection.value && page.booksError) {
    page.resetBooks()
  }
}

watch(collectionId, async () => {
  page.resetNarrowing()
  await retryCollectionLoad()
})

defineOptions({ name: 'CollectionView' })
</script>

<template>
  <div class="flex h-full flex-col">
    <BookListDialogs :page="page" :in-collection="isCollectionOwner" @remove-from-collection="handleRemoveFromCollection" />

    <EditCollectionDialog
      v-if="collection && isCollectionOwner"
      :open="editCollectionOpen"
      :collection="collection"
      @close="closeCollectionEditor"
      @deleted="handleCollectionDeleted"
    />

    <ConfirmDialog
      :open="confirmDeleteOpen"
      :title="t('components.browseHeader.menu.deleteCollection')"
      :description="t('components.browseHeader.menu.confirmDelete', { name: collection?.name ?? t('views.collection.title') })"
      :confirm-label="t('common.delete')"
      :busy="deletingCollection"
      @confirm="handleDeleteCollection"
      @cancel="cancelCollectionDelete"
    />

    <section class="flex flex-1 flex-col min-h-0">
      <BrowseHeader
        :eyebrow="t('components.browseHeader.eyebrow.collection')"
        :title="collection?.name ?? t('views.collection.title')"
        :icon="collection?.icon || 'FolderOpen'"
        fallback-icon="FolderOpen"
        :folded-count="foldedCount"
        :switcher="Number.isFinite(collectionId) ? { kind: 'collection', id: collectionId } : null"
        :scroll-container="page.mainEl"
      >
        <template #facts>
          <template v-for="(fact, index) in headerFacts" :key="fact.key">
            <span v-if="index > 0" class="size-[3px] shrink-0 rounded-full bg-muted-foreground" aria-hidden="true" />
            <span class="truncate" :class="fact.key === 'count' ? 'shrink-0' : ''">{{ fact.text }}</span>
          </template>
        </template>

        <template #actions>
          <button
            v-if="isCollectionOwner && collection"
            type="button"
            :class="cn(outlineButton, 'hidden md:inline-flex')"
            @click="openCollectionEditor"
          >
            <Pencil :size="14" class="text-muted-foreground" aria-hidden="true" />
            {{ t('common.edit') }}
          </button>
          <BrowsePageMenu v-if="hasPageMenu" :name="collection?.name ?? t('views.collection.title')">
            <DropdownMenuItem v-if="isCollectionOwner && collection" class="md:hidden" @click="openCollectionEditor">
              <Pencil :size="14" class="mr-2" />
              {{ t('views.collection.editCollection') }}
            </DropdownMenuItem>
            <DropdownMenuItem v-if="page.canExport" @click="page.openMetadataExport">
              <FileSpreadsheet :size="14" class="mr-2" />
              {{ t('views.bookView.exportMetadata') }}
            </DropdownMenuItem>
            <template v-if="isCollectionOwner && collection">
              <DropdownMenuSeparator />
              <DropdownMenuItem class="text-destructive focus:text-destructive" @click="requestDelete">
                <Trash2 :size="14" class="mr-2" />
                {{ t('components.browseHeader.menu.deleteCollection') }}
              </DropdownMenuItem>
            </template>
          </BrowsePageMenu>
        </template>

        <template #bar>
          <BookListToolbar :page="page" collection-scoped-sort />
        </template>
      </BrowseHeader>

      <main
        :ref="page.bindMain"
        :class="page.effectiveViewMode === 'table' ? 'flex-1 min-h-0 flex flex-col overflow-hidden' : 'flex-1 min-h-0 overflow-y-auto'"
      >
        <div v-if="collectionLoadError" class="flex flex-col items-center justify-center gap-3 py-24 text-center">
          <div class="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle :size="28" />
          </div>
          <p class="text-sm font-medium text-foreground">{{ t('views.collection.loadError') }}</p>
          <p class="max-w-md text-xs text-muted-foreground">{{ collectionLoadError }}</p>
          <button
            class="rounded-md border border-input px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
            @click="retryCollectionLoad"
          >
            {{ t('views.common.retry') }}
          </button>
        </div>

        <EntityNotFound v-else-if="collectionNotFound" :entity="t('views.entity.collection')" />

        <div
          v-else-if="page.booksInitialized && !page.loading && page.books.length === 0"
          class="flex flex-col items-center justify-center gap-3 py-24 text-center"
        >
          <div class="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
            <FolderOpen :size="28" class="text-muted-foreground" />
          </div>
          <p class="text-sm font-medium text-foreground">
            {{ page.debouncedQuery ? t('views.collection.empty.noSearchMatch') : t('views.collection.empty.noBooks') }}
          </p>
          <p class="text-xs text-muted-foreground">
            {{ page.debouncedQuery ? t('views.collection.empty.noSearchMatchHint') : t('views.collection.empty.noBooksHint') }}
          </p>
        </div>

        <BookListContent :page="page" :default-sort="COLLECTION_DEFAULT_SORT" />
      </main>
    </section>
  </div>
</template>
