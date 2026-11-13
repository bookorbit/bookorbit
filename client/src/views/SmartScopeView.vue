<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { formatNumber } from '@/i18n/formatters'
import { AlertTriangle, Aperture, FileSpreadsheet, Settings2, Tablet, Trash2 } from '@lucide/vue'
import { DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import EntityNotFound from '@/components/EntityNotFound.vue'
import BrowseHeader from '@/components/browse-header/BrowseHeader.vue'
import BrowseInlineGroup from '@/components/browse-header/BrowseInlineGroup.vue'
import BrowseRuleChips from '@/components/browse-header/BrowseRuleChips.vue'
import BrowsePageMenu from '@/components/browse-header/BrowsePageMenu.vue'
import { barDivider, outlineButton } from '@/components/browse-header/browse-header'
import BookListContent from '@/features/book/components/list-page/BookListContent.vue'
import BookListDialogs from '@/features/book/components/list-page/BookListDialogs.vue'
import BookListToolbar from '@/features/book/components/list-page/BookListToolbar.vue'
import { useBookListPage } from '@/features/book/composables/useBookListPage'
import { DEFAULT_SORT } from '@/features/book/lib/sort-defaults'
import SmartScopeEditorPanel from '@/features/smart-scope/components/SmartScopeEditorPanel.vue'
import { useSmartScopes } from '@/features/smart-scope/composables/useSmartScopes'
import { useSmartScopeKoboSync } from '@/features/smart-scope/composables/useSmartScopeKoboSync'
import { usePageTitle } from '@/composables/usePageTitle'
import { cn } from '@/lib/utils'
import { normalizeCoverAspectRatio, type CoverAspectRatio, type GroupRule, type SortSpec } from '@bookorbit/types'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const smartScopeId = shallowRef(Number(route.params.id))
const { smartScopes, loaded: smartScopesLoaded, error: smartScopesError, fetchSmartScopes, deleteSmartScope } = useSmartScopes()
const smartScope = computed(() => smartScopes.value.find((l) => l.id === smartScopeId.value))
const smartScopeNotFound = ref(false)
const coverAspectRatio = computed<CoverAspectRatio>(() => normalizeCoverAspectRatio(smartScope.value?.coverAspectRatio))
const scopeDefaultSort = computed<SortSpec[]>(() => (smartScope.value?.defaultSort?.length ? [...smartScope.value.defaultSort] : DEFAULT_SORT))
// A scope's own default sort arrives with the scope, so nothing is asked for until it has loaded.
const scopeQueryReady = ref(false)

const page = useBookListPage({
  viewType: 'smartScope',
  scopeId: smartScopeId,
  listEndpoint: (id) => `/api/v1/smart-scopes/${id}/books/query`,
  bucketsEndpoint: (id) => `/api/v1/smart-scopes/${id}/books/jump-buckets`,
  defaultSort: scopeDefaultSort,
  collapseScope: (id) => ({ smartScopeId: id }),
  coverAspectRatio,
  enabled: scopeQueryReady,
  backupFilePrefix: 'smart-scope',
})

const smartScopeLoadError = computed(() => smartScopesError.value ?? page.booksError)

const pageTitle = computed(() => {
  if (smartScope.value?.name) return t('views.smartScope.pageTitle', { name: smartScope.value.name })
  return Number.isFinite(smartScopeId.value) ? t('views.smartScope.pageTitleWithId', { id: smartScopeId.value }) : t('views.smartScope.title')
})
usePageTitle(pageTitle)

const scopeRules = computed(() => (smartScope.value?.filter as GroupRule | null | undefined) ?? null)

watch(
  smartScope,
  async (scope) => {
    scopeQueryReady.value = false
    page.loadSort()
    if (!scope) return
    await nextTick()
    if (smartScope.value?.id === scope.id) scopeQueryReady.value = true
  },
  { immediate: true },
)

const editorOpen = ref(false)
const confirmDeleteOpen = ref(false)
const deleting = ref(false)

const {
  isOwner: isSmartScopeOwner,
  enabled: koboSyncEnabled,
  canToggle: canToggleKoboSync,
  pending: koboSyncPending,
  toggle: toggleKoboSync,
} = useSmartScopeKoboSync(smartScope)

async function handleToggleKoboSync() {
  const name = smartScope.value?.name ?? t('views.smartScope.defaultName')
  try {
    const next = await toggleKoboSync()
    if (next === null) return
    toast.success(next ? t('views.smartScope.toast.koboSyncEnabled', { name }) : t('views.smartScope.toast.koboSyncDisabled', { name }))
  } catch {
    toast.error(t('views.smartScope.toast.koboSyncFailed', { name }))
  }
}

const hasPageMenu = computed(() => isSmartScopeOwner.value || page.canExport || canToggleKoboSync.value)

interface HeaderFact {
  key: string
  text: string
}

const headerFacts = computed<HeaderFact[]>(() => {
  const facts: HeaderFact[] = []
  const count = page.countFact(smartScope.value?.bookCount)
  if (count) facts.push({ key: 'count', text: count })
  if (koboSyncEnabled.value) facts.push({ key: 'kobo', text: t('components.browseHeader.facts.syncsToKobo') })
  return facts
})

const foldedCount = computed(() => {
  const count = smartScope.value?.bookCount
  return typeof count === 'number' ? formatNumber(count) : undefined
})

function requestDelete() {
  confirmDeleteOpen.value = true
}

function cancelDelete() {
  confirmDeleteOpen.value = false
}

async function handleDelete() {
  deleting.value = true
  const name = smartScope.value?.name ?? t('views.smartScope.defaultName')
  try {
    await deleteSmartScope(smartScopeId.value)
    toast.success(t('views.smartScope.toast.deleted', { name }))
    router.push({ name: 'dashboard' })
  } catch {
    toast.error(t('views.smartScope.toast.deleteFailed', { name }))
  } finally {
    deleting.value = false
    confirmDeleteOpen.value = false
  }
}

function openEditor() {
  if (!isSmartScopeOwner.value) return
  editorOpen.value = true
}

function closeEditor() {
  editorOpen.value = false
}

onMounted(async () => {
  await retrySmartScopeLoad()
})

async function retrySmartScopeLoad() {
  smartScopeNotFound.value = false
  await fetchSmartScopes()
  if (smartScopesError.value) return
  if (!smartScope.value && smartScopesLoaded.value) {
    smartScopeNotFound.value = true
    return
  }
  if (smartScope.value && page.booksError) {
    page.resetBooks()
  }
}

watch(smartScopeId, async () => {
  page.resetNarrowing()
  await retrySmartScopeLoad()
})

defineOptions({ name: 'SmartScopeView' })
</script>

<template>
  <div class="flex h-full flex-col">
    <SmartScopeEditorPanel :open="editorOpen" :smartScope="smartScope" @close="closeEditor" @saved="page.reload" />

    <BookListDialogs :page="page" />

    <ConfirmDialog
      :open="confirmDeleteOpen"
      :title="t('components.browseHeader.menu.deleteSmartScope')"
      :description="t('components.browseHeader.menu.confirmDelete', { name: smartScope?.name ?? t('views.smartScope.defaultName') })"
      :confirm-label="t('common.delete')"
      :busy="deleting"
      @confirm="handleDelete"
      @cancel="cancelDelete"
    />

    <section class="flex flex-1 flex-col min-h-0">
      <BrowseHeader
        :eyebrow="t('components.browseHeader.eyebrow.smartScope')"
        :title="smartScope?.name ?? t('views.smartScope.title')"
        :icon="smartScope?.icon ?? undefined"
        fallback-icon="Aperture"
        :folded-count="foldedCount"
        :switcher="Number.isFinite(smartScopeId) ? { kind: 'smartScope', id: smartScopeId } : null"
        :scroll-container="page.mainEl"
      >
        <template #facts>
          <template v-for="(fact, index) in headerFacts" :key="fact.key">
            <span v-if="index > 0" class="size-[3px] shrink-0 rounded-full bg-muted-foreground" aria-hidden="true" />
            <span class="inline-flex min-w-0 items-center gap-1.5 truncate" :class="fact.key === 'count' ? 'shrink-0' : ''">
              <Tablet v-if="fact.key === 'kobo'" :size="13" class="shrink-0" aria-hidden="true" />
              {{ fact.text }}
            </span>
          </template>
        </template>

        <template #actions>
          <button v-if="isSmartScopeOwner" type="button" :class="cn(outlineButton, 'hidden md:inline-flex')" @click="openEditor">
            <Settings2 :size="14" class="text-muted-foreground" aria-hidden="true" />
            {{ t('components.browseHeader.menu.editRules') }}
          </button>
          <BrowsePageMenu v-if="hasPageMenu" :name="smartScope?.name ?? t('views.smartScope.title')">
            <DropdownMenuItem v-if="isSmartScopeOwner" class="md:hidden" @click="openEditor">
              <Settings2 :size="14" class="mr-2" />
              {{ t('components.browseHeader.menu.editRules') }}
            </DropdownMenuItem>
            <DropdownMenuItem v-if="page.canExport" @click="page.openMetadataExport">
              <FileSpreadsheet :size="14" class="mr-2" />
              {{ t('views.bookView.exportMetadata') }}
            </DropdownMenuItem>
            <DropdownMenuCheckboxItem
              v-if="canToggleKoboSync"
              :model-value="koboSyncEnabled"
              :disabled="koboSyncPending"
              @update:model-value="handleToggleKoboSync"
            >
              {{ t('views.smartScope.koboSync.label') }}
            </DropdownMenuCheckboxItem>
            <template v-if="isSmartScopeOwner">
              <DropdownMenuSeparator />
              <DropdownMenuItem class="text-destructive focus:text-destructive" @click="requestDelete">
                <Trash2 :size="14" class="mr-2" />
                {{ t('components.browseHeader.menu.deleteSmartScope') }}
              </DropdownMenuItem>
            </template>
          </BrowsePageMenu>
        </template>

        <template #bar>
          <BookListToolbar :page="page" :filter-max-depth="4">
            <template v-if="scopeRules" #extras>
              <span :class="barDivider" aria-hidden="true" />
              <BrowseInlineGroup :label="t('components.browseHeader.facets.rules')" :value="formatNumber(scopeRules.rules.length)" hide-on-phone>
                <BrowseRuleChips :rules="scopeRules" :editable="isSmartScopeOwner" @edit="openEditor" />
              </BrowseInlineGroup>
            </template>
          </BookListToolbar>
        </template>
      </BrowseHeader>

      <main
        :ref="page.bindMain"
        :class="page.effectiveViewMode === 'table' ? 'flex-1 min-h-0 flex flex-col overflow-hidden' : 'flex-1 min-h-0 overflow-y-auto'"
      >
        <div v-if="smartScopeLoadError" class="flex flex-col items-center justify-center gap-3 py-24 text-center">
          <div class="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle :size="28" />
          </div>
          <p class="text-sm font-medium text-foreground">{{ t('views.smartScope.loadError') }}</p>
          <p class="max-w-md text-xs text-muted-foreground">{{ smartScopeLoadError }}</p>
          <button
            class="rounded-md border border-input px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
            @click="retrySmartScopeLoad"
          >
            {{ t('views.common.retry') }}
          </button>
        </div>

        <EntityNotFound v-else-if="smartScopeNotFound" :entity="t('views.entity.smartScope')" />

        <template v-else>
          <!-- Empty state: no rules configured -->
          <div
            v-if="page.booksInitialized && !page.loading && !smartScope?.filter && page.books.length === 0"
            class="flex flex-col items-center justify-center py-24 gap-4 text-center"
          >
            <div class="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
              <Settings2 :size="28" class="text-muted-foreground" />
            </div>
            <div class="flex flex-col gap-1">
              <p class="text-sm font-medium text-foreground">{{ t('views.smartScope.empty.noRules') }}</p>
              <p class="text-xs text-muted-foreground max-w-xs">
                {{ t('views.smartScope.empty.noRulesHint') }}
              </p>
            </div>
            <button
              v-if="isSmartScopeOwner"
              @click="openEditor"
              class="h-9 px-5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              {{ t('views.smartScope.empty.configure') }}
            </button>
          </div>

          <!-- Empty state: rules set but no matches -->
          <div
            v-else-if="page.booksInitialized && !page.loading && page.books.length === 0 && smartScope?.filter"
            class="flex flex-col items-center justify-center py-24 gap-3 text-center"
          >
            <div class="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
              <Aperture :size="28" class="text-muted-foreground" />
            </div>
            <p class="text-sm font-medium text-foreground">{{ t('views.smartScope.empty.noMatch') }}</p>
            <p class="text-xs text-muted-foreground">{{ t('views.smartScope.empty.noMatchHint') }}</p>
            <button v-if="isSmartScopeOwner" @click="openEditor" class="text-xs text-primary hover:underline">
              {{ t('views.smartScope.empty.edit') }}
            </button>
          </div>

          <BookListContent :page="page" />
        </template>
      </main>
    </section>
  </div>
</template>
