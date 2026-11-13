<script setup lang="ts">
import { computed, onActivated, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { useMediaQuery } from '@vueuse/core'
import { toast } from 'vue-sonner'
import { AlertTriangle, ChevronRight, FileSpreadsheet, GitMerge, Pencil, SearchX, Telescope, Trash2, Wrench } from '@lucide/vue'
import { Permission, taxonomyRouteSegment, type GroupRule, type TaxonomyKind, type TaxonomyName } from '@bookorbit/types'

import EntityNotFound from '@/components/EntityNotFound.vue'
import BrowseHeader from '@/components/browse-header/BrowseHeader.vue'
import BrowseLibraryPicker from '@/components/browse-header/BrowseLibraryPicker.vue'
import BrowsePageMenu from '@/components/browse-header/BrowsePageMenu.vue'
import { outlineButton } from '@/components/browse-header/browse-header'
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { usePageTitle } from '@/composables/usePageTitle'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import BookListContent from '@/features/book/components/list-page/BookListContent.vue'
import BookListDialogs from '@/features/book/components/list-page/BookListDialogs.vue'
import BookListToolbar from '@/features/book/components/list-page/BookListToolbar.vue'
import { useBookListPage } from '@/features/book/composables/useBookListPage'
import SaveAsSmartScopeDialog from '@/features/smart-scope/components/SaveAsSmartScopeDialog.vue'
import { deleteEntity, mergeEntities, renameEntity } from '@/features/tools/api/entity-manager'
import DeleteModal from '@/features/tools/entity-manager/components/DeleteModal.vue'
import RenameModal from '@/features/tools/entity-manager/components/RenameModal.vue'
import { formatNumber } from '@/i18n/formatters'
import { cn } from '@/lib/utils'
import TaxonomyMergeDialog from '../components/TaxonomyMergeDialog.vue'
import TaxonomySimilarStrip from '../components/TaxonomySimilarStrip.vue'
import TaxonomyTitleSwitcher from '../components/TaxonomyTitleSwitcher.vue'
import { useTaxonomyDetail } from '../composables/useTaxonomyDetail'
import { taxonomyRouteNames } from '../lib/taxonomy-text'

/** `/genres/:id` and `/tags/:id`: every book carrying one name, on the shared book-list shell. */
const props = defineProps<{ kind: TaxonomyKind; id: number }>()

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { hasPermission } = usePermissions()
const isPhone = useMediaQuery('(max-width: 767px)')

const entityId = shallowRef(props.id)
const isTag = props.kind === 'tag'
const segment = taxonomyRouteSegment(props.kind)
const routeNames = taxonomyRouteNames(props.kind)

function parseLibraryId(value: unknown): number | null {
  const raw = typeof value === 'string' ? Number(value) : NaN
  return Number.isInteger(raw) && raw > 0 ? raw : null
}

const libraryId = ref<number | null>(parseLibraryId(route.query.libraryId))
const { detail, similar, loaded, notFound, error: detailError, load } = useTaxonomyDetail(props.kind, entityId)

function scoped(path: string): string {
  return libraryId.value ? `${path}?libraryId=${libraryId.value}` : path
}

const page = useBookListPage({
  viewType: props.kind,
  scopeId: entityId,
  listEndpoint: (id) => scoped(`/api/v1/${segment}/${id}/books/query`),
  bucketsEndpoint: (id) => scoped(`/api/v1/${segment}/${id}/books/jump-buckets`),
  collapseScope: () => ({ taxonomyPages: true }),
  backupFilePrefix: props.kind,
})

const name = computed(() => detail.value?.name ?? '')
const fallbackTitle = computed(() => (isTag ? t('titles.tag') : t('titles.genre')))
usePageTitle(computed(() => name.value || `${fallbackTitle.value} #${entityId.value}`))

const libraries = computed(() => detail.value?.libraries ?? [])
const activeLibrary = computed(() => libraries.value.find((library) => library.id === libraryId.value) ?? null)

const countFact = computed(() => {
  const entry = detail.value
  if (!entry) return null
  if (!activeLibrary.value) return page.countFact(entry.bookCount)
  if (page.isNarrowed) return page.countFact(activeLibrary.value.bookCount)
  return t('components.browseHeader.facts.booksOf', { matching: formatNumber(activeLibrary.value.bookCount), total: entry.bookCount })
})
const foldedCount = computed(() => (detail.value ? formatNumber(detail.value.bookCount) : undefined))
const loadError = computed(() => detailError.value ?? page.booksError)

const canManage = computed(() => hasPermission(Permission.LibraryEditMetadata))
const hasPageMenu = computed(() => canManage.value || page.canExport || isPhone.value)
const entityManagerRoute = computed(() => ({ name: 'tools-entity-manager', query: { type: props.kind, q: name.value } }))

/* ---------- Header ---------- */

function handleUp(event: MouseEvent) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
  event.preventDefault()
  const back = window.history.state?.back
  if (typeof back === 'string' && back.split('?')[0] === `/${segment}`) router.back()
  else void router.push({ name: routeNames.index, query: libraryId.value ? { libraryId: String(libraryId.value) } : undefined })
}

function setLibraryId(value: number | null) {
  libraryId.value = value
}

watch(libraryId, (value) => {
  void router.replace({ query: { ...route.query, libraryId: value ? String(value) : undefined } })
})

/* ---------- Save as Smart Scope ---------- */

const saveScopeOpen = ref(false)

const scopeFilter = computed<GroupRule | undefined>(() => {
  if (!detail.value) return undefined
  const rules: GroupRule['rules'] = [{ type: 'rule', field: props.kind, operator: 'includesAny', value: [detail.value.name] }]
  if (activeLibrary.value) rules.push({ type: 'rule', field: 'library', operator: 'includesAny', value: [activeLibrary.value.name] })
  if (page.filter?.rules.length) rules.push(page.filter)
  return { type: 'group', join: 'AND', rules }
})

function openSaveScope() {
  saveScopeOpen.value = true
}

function closeSaveScope() {
  saveScopeOpen.value = false
}

/* ---------- Manage: the Entity Manager's actions, on this one name ---------- */

const renameOpen = ref(false)
const mergeOpen = ref(false)
const deleteOpen = ref(false)
const managing = ref(false)

const mergeSource = computed<TaxonomyName>(() => ({ id: entityId.value, name: name.value, bookCount: detail.value?.bookCount ?? 0 }))

function openRename() {
  renameOpen.value = true
}

function closeRename() {
  if (!managing.value) renameOpen.value = false
}

function openMerge() {
  mergeOpen.value = true
}

function closeMerge() {
  if (!managing.value) mergeOpen.value = false
}

function openDelete() {
  deleteOpen.value = true
}

function closeDelete() {
  if (!managing.value) deleteOpen.value = false
}

function openEntityManager() {
  void router.push(entityManagerRoute.value)
}

async function handleRename(newName: string, writeFiles: boolean) {
  managing.value = true
  try {
    await renameEntity(props.kind, { entityId: entityId.value, newName, writeFiles })
    renameOpen.value = false
    toast.success(t('taxonomy.page.renamed', { name: newName }))
    await load()
    page.reload()
  } catch {
    toast.error(t('taxonomy.page.renameFailed'))
  } finally {
    managing.value = false
  }
}

async function handleMerge(target: TaxonomyName, writeFiles: boolean) {
  managing.value = true
  try {
    await mergeEntities(props.kind, { targetEntityId: target.id, sourceEntityIds: [entityId.value], writeFiles })
    mergeOpen.value = false
    toast.success(t('taxonomy.page.merged', { name: target.name }))
    void router.replace({ name: routeNames.detail, params: { id: target.id }, query: route.query })
  } catch {
    toast.error(t('taxonomy.page.mergeFailed'))
  } finally {
    managing.value = false
  }
}

async function handleDelete(mode: 'soft' | 'hard' | 'inline', writeFiles: boolean) {
  managing.value = true
  try {
    await deleteEntity(props.kind, { entityId: entityId.value, mode: mode === 'inline' ? 'hard' : mode, writeFiles })
    deleteOpen.value = false
    toast.success(t('taxonomy.page.deleted', { name: name.value }))
    void router.replace({ name: routeNames.index })
  } catch {
    toast.error(t('taxonomy.page.deleteFailed'))
  } finally {
    managing.value = false
  }
}

/* ---------- Lifecycle ---------- */

async function retry() {
  await load()
  if (detail.value && page.booksError) page.resetBooks()
}

let activatedOnce = false
onMounted(load)
onActivated(() => {
  if (activatedOnce) void load()
  activatedOnce = true
})

defineOptions({ name: 'TaxonomyView' })
</script>

<template>
  <div class="flex h-full flex-col">
    <BookListDialogs :page="page" />

    <SaveAsSmartScopeDialog
      :open="saveScopeOpen"
      :filter="scopeFilter"
      :sort="page.tableSort"
      :initial-name="name"
      :initial-icon="isTag ? 'Tag' : 'Shapes'"
      @close="closeSaveScope"
    />
    <RenameModal v-if="renameOpen && detail" :current-name="detail.name" :loading="managing" @confirm="handleRename" @cancel="closeRename" />
    <DeleteModal
      v-if="deleteOpen && detail"
      :entity-name="detail.name"
      :is-inline="false"
      :loading="managing"
      @confirm="handleDelete"
      @cancel="closeDelete"
    />
    <TaxonomyMergeDialog
      v-if="detail"
      :open="mergeOpen"
      :kind="kind"
      :source="mergeSource"
      :busy="managing"
      @confirm="handleMerge"
      @cancel="closeMerge"
    />

    <section class="flex min-h-0 flex-1 flex-col">
      <BrowseHeader
        :eyebrow="isTag ? t('taxonomy.index.tagsTitle') : t('taxonomy.index.genresTitle')"
        :title="name || fallbackTitle"
        :icon="isTag ? 'Tag' : 'Shapes'"
        :fallback-icon="isTag ? 'Tag' : 'Shapes'"
        :folded-count="foldedCount"
        :scroll-container="page.mainEl"
      >
        <template #eyebrow>
          <RouterLink v-slot="{ href }" :to="{ name: routeNames.index }" custom>
            <a
              :href="href"
              class="inline-flex w-fit items-center gap-[3px] rounded-[4px] text-[10.5px] leading-[13px] font-bold tracking-[0.08em] text-muted-foreground uppercase transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              @click="handleUp"
            >
              {{ isTag ? t('taxonomy.index.tagsTitle') : t('taxonomy.index.genresTitle') }}
              <ChevronRight :size="11" aria-hidden="true" />
            </a>
          </RouterLink>
        </template>

        <template v-if="detail" #title>
          <TaxonomyTitleSwitcher :kind="kind" :id="entityId" :title="detail.name" :library-id="libraryId" />
        </template>

        <template #facts>
          <span v-if="countFact" class="shrink-0 truncate">{{ countFact }}</span>
        </template>

        <template v-if="detail" #actions>
          <button type="button" :class="cn(outlineButton, 'hidden md:inline-flex')" @click="openSaveScope">
            <Telescope :size="14" class="text-muted-foreground" aria-hidden="true" />
            {{ t('views.library.saveAsSmartScope') }}
          </button>
          <BrowsePageMenu v-if="hasPageMenu" :name="detail.name">
            <DropdownMenuItem class="md:hidden" @click="openSaveScope">
              <Telescope :size="14" class="me-2" />
              {{ t('views.library.saveAsSmartScope') }}
            </DropdownMenuItem>
            <DropdownMenuItem v-if="page.canExport" @click="page.openMetadataExport">
              <FileSpreadsheet :size="14" class="me-2" />
              {{ t('views.bookView.exportMetadata') }}
            </DropdownMenuItem>
            <template v-if="canManage">
              <DropdownMenuSeparator v-if="page.canExport || isPhone" />
              <DropdownMenuLabel class="pt-[7px] pb-1 text-[10.5px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
                {{ isTag ? t('taxonomy.page.manageTag') : t('taxonomy.page.manageGenre') }}
              </DropdownMenuLabel>
              <DropdownMenuItem @click="openRename">
                <Pencil :size="14" class="me-2" />
                {{ t('taxonomy.page.rename') }}
              </DropdownMenuItem>
              <DropdownMenuItem @click="openMerge">
                <GitMerge :size="14" class="me-2" />
                {{ isTag ? t('taxonomy.page.mergeTagEllipsis') : t('taxonomy.page.mergeGenreEllipsis') }}
              </DropdownMenuItem>
              <DropdownMenuItem @click="openEntityManager">
                <Wrench :size="14" class="me-2" />
                {{ t('taxonomy.page.openInEntityManager') }}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem class="text-destructive focus:text-destructive" @click="openDelete">
                <Trash2 :size="14" class="me-2" />
                {{ isTag ? t('taxonomy.page.deleteTag') : t('taxonomy.page.deleteGenre') }}
              </DropdownMenuItem>
            </template>
          </BrowsePageMenu>
        </template>

        <template v-if="similar.length" #below>
          <TaxonomySimilarStrip :kind="kind" :items="similar" :library-id="libraryId" :entity-manager-to="canManage ? entityManagerRoute : null" />
        </template>

        <template #bar>
          <BookListToolbar :page="page" :search-placeholder="detail ? t('taxonomy.page.searchIn', { name: detail.name }) : undefined">
            <template v-if="libraries.length > 1" #extras>
              <BrowseLibraryPicker
                show-counts
                :menu-label="t('components.browseHeader.facets.library')"
                :libraries="libraries"
                :model-value="libraryId"
                @update:model-value="setLibraryId"
              />
            </template>
          </BookListToolbar>
        </template>
      </BrowseHeader>

      <main
        :ref="page.bindMain"
        :class="page.effectiveViewMode === 'table' ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'min-h-0 flex-1 overflow-y-auto'"
      >
        <EntityNotFound v-if="notFound" :entity="fallbackTitle" />

        <div v-else-if="loadError" class="flex flex-col items-center justify-center gap-3 py-24 text-center">
          <div class="flex size-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle :size="28" />
          </div>
          <p class="text-sm font-medium text-foreground">{{ t('taxonomy.page.loadError') }}</p>
          <button class="rounded-md border border-input px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted" @click="retry">
            {{ t('views.common.retry') }}
          </button>
        </div>

        <template v-else-if="loaded && detail">
          <div
            v-if="page.booksInitialized && !page.loading && page.books.length === 0"
            class="flex flex-col items-center justify-center gap-3 py-24 text-center"
          >
            <div class="flex size-16 items-center justify-center rounded-full bg-muted">
              <SearchX :size="28" class="text-muted-foreground" />
            </div>
            <p class="text-sm font-medium text-foreground">
              {{ page.isNarrowed ? t('views.collection.empty.noSearchMatch') : t('taxonomy.page.noBooksInLibrary') }}
            </p>
            <p class="text-xs text-muted-foreground">
              {{ page.isNarrowed ? t('views.collection.empty.noSearchMatchHint') : t('taxonomy.page.noBooksInLibraryHint') }}
            </p>
          </div>

          <BookListContent :page="page" />
        </template>
      </main>
    </section>
  </div>
</template>
