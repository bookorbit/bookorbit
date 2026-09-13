<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { AlertCircle, Loader2, PackageCheck, ScanSearch, Trash2 } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import type { MissingResourceCategory } from '@bookorbit/types'

import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { Button } from '@/components/ui/button'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useMissingResources } from '../../composables/useMissingResources'
import MissingResourceCategoryTabs from '../components/MissingResourceCategoryTabs.vue'
import MissingResourceSweepPanel from '../components/MissingResourceSweepPanel.vue'
import MissingResourceTable from '../components/MissingResourceTable.vue'

const { t } = useI18n()
const { hasPermission, isDemoRestrictedAccount } = usePermissions()
const resources = useMissingResources()
const confirmOpen = ref(false)

const canUseTool = computed(() => hasPermission('library_delete_books'))
const canCleanCategory = computed<Record<MissingResourceCategory, boolean>>(() => ({
  missing_books: canUseTool.value,
  broken_covers: canUseTool.value && hasPermission('library_edit_metadata'),
  orphaned_cover_dirs: canUseTool.value && hasPermission('manage_libraries'),
}))
const visibleCategories = computed<MissingResourceCategory[]>(() =>
  (['missing_books', 'broken_covers', 'orphaned_cover_dirs'] as const).filter((category) => canCleanCategory.value[category]),
)
const canCleanCurrent = computed(() => canCleanCategory.value[resources.category.value] && !isDemoRestrictedAccount.value)
const showSelectAllPrompt = computed(
  () => !resources.selectAllMatching.value && resources.allOnPageSelected.value && resources.total.value > resources.items.value.length,
)
const isEmpty = computed(() => !resources.loading.value && resources.loaded.value && resources.items.value.length === 0)
const confirmDescription = computed(() => t(`tools.missingResources.confirm.${resources.category.value}`, { count: resources.selectionCount.value }))

onMounted(() => {
  if (canUseTool.value) void resources.initialize()
})

function handleRunSweep(): void {
  void resources.runSweep()
}

function handleCategoryChange(category: MissingResourceCategory): void {
  void resources.setCategory(category)
}

function handleToggle(id: number): void {
  resources.toggleSelection(id)
}

function handleTogglePage(): void {
  resources.togglePageSelection()
}

function handleSelectAll(): void {
  resources.selectAll()
}

function handleClearSelection(): void {
  resources.clearSelection()
}

function handleRequestClean(): void {
  confirmOpen.value = true
}

function handleCancelClean(): void {
  confirmOpen.value = false
}

async function handleConfirmClean(): Promise<void> {
  const done = await resources.cleanSelected()
  if (done) confirmOpen.value = false
}

function handlePreviousPage(): void {
  void resources.setPage(resources.page.value - 1)
}

function handleNextPage(): void {
  void resources.setPage(resources.page.value + 1)
}
</script>

<template>
  <div v-if="!canUseTool" role="alert" class="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
    {{ t('tools.missingResources.accessDenied') }}
  </div>

  <div v-else class="flex h-full min-h-0 w-full flex-col gap-4 overflow-y-auto pr-1">
    <MissingResourceSweepPanel :sweep="resources.sweep.value" :sweeping="resources.sweeping.value" @run="handleRunSweep" />

    <div
      v-if="resources.error.value"
      role="alert"
      class="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
    >
      <AlertCircle class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{{ resources.error.value }}</span>
    </div>

    <MissingResourceCategoryTabs
      :model-value="resources.category.value"
      :counts="resources.counts.value"
      :sweep-ready="resources.sweepReady.value"
      :visible-categories="visibleCategories"
      @update:model-value="handleCategoryChange"
    />

    <section
      v-if="resources.needsSweep.value"
      key="needs-sweep"
      class="flex flex-1 flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border/60 bg-card/20 p-10 text-center"
    >
      <div class="flex size-14 items-center justify-center rounded-full bg-muted/70">
        <ScanSearch class="size-6 text-muted-foreground" aria-hidden="true" />
      </div>
      <div class="space-y-1">
        <p class="text-base font-semibold text-foreground">{{ t('tools.missingResources.needsSweep.title') }}</p>
        <p class="max-w-md text-sm text-muted-foreground">{{ t('tools.missingResources.needsSweep.description') }}</p>
      </div>
    </section>

    <section v-else key="results" class="flex min-h-0 flex-1 flex-col gap-3">
      <div v-if="!isEmpty" class="flex flex-wrap items-center justify-between gap-3">
        <p class="text-sm text-muted-foreground" aria-live="polite">
          {{ t(`tools.missingResources.found.${resources.category.value}`, { count: resources.total.value }) }}
        </p>
        <div v-if="resources.hasSelection.value" class="flex items-center gap-2">
          <Button variant="ghost" size="sm" @click="handleClearSelection">
            {{ t('tools.missingResources.clearSelection') }}
          </Button>
          <Button v-if="canCleanCurrent" variant="destructive" size="sm" :disabled="resources.cleaning.value" @click="handleRequestClean">
            <Trash2 aria-hidden="true" />
            {{ t('tools.missingResources.cleanSelected', { count: resources.selectionCount.value }) }}
          </Button>
        </div>
      </div>

      <p v-if="resources.selectAllMatching.value" class="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        {{ t('tools.missingResources.allSelected', { count: resources.total.value }) }}
      </p>
      <button
        v-else-if="showSelectAllPrompt"
        type="button"
        class="self-start rounded-md px-1 text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        @click="handleSelectAll"
      >
        {{ t('tools.missingResources.selectAllMatching', { count: resources.total.value }) }}
      </button>

      <div v-if="resources.loading.value && !resources.loaded.value" key="loading" class="flex flex-1 items-center justify-center py-10">
        <Loader2 class="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
        <span class="sr-only">{{ t('common.loading') }}</span>
      </div>

      <div
        v-else-if="isEmpty"
        key="empty"
        class="flex flex-1 flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border/60 bg-card/20 p-10 text-center"
      >
        <div class="flex size-14 items-center justify-center rounded-full bg-muted/70">
          <PackageCheck class="size-6 text-muted-foreground" aria-hidden="true" />
        </div>
        <div class="space-y-1">
          <p class="text-base font-semibold text-foreground">{{ t(`tools.missingResources.empty.${resources.loadedCategory.value}`) }}</p>
          <p class="max-w-md text-sm text-muted-foreground">{{ t('tools.missingResources.empty.description') }}</p>
        </div>
      </div>

      <div v-else key="list">
        <MissingResourceTable
          :key="resources.loadedCategory.value"
          :category="resources.loadedCategory.value"
          :items="resources.items.value"
          :selected-ids="resources.selectedIds.value"
          :select-all-matching="resources.selectAllMatching.value"
          :all-on-page-selected="resources.allOnPageSelected.value"
          :disabled="resources.cleaning.value"
          @toggle="handleToggle"
          @toggle-page="handleTogglePage"
        />
      </div>

      <nav
        v-if="resources.totalPages.value > 1"
        class="flex items-center justify-center gap-3"
        :aria-label="t('tools.missingResources.pagination.label')"
      >
        <Button variant="outline" size="sm" :disabled="resources.page.value <= 1 || resources.loading.value" @click="handlePreviousPage">
          {{ t('common.previous') }}
        </Button>
        <span class="text-sm text-muted-foreground">
          {{ t('tools.missingResources.pagination.page', { page: resources.page.value, total: resources.totalPages.value }) }}
        </span>
        <Button
          variant="outline"
          size="sm"
          :disabled="resources.page.value >= resources.totalPages.value || resources.loading.value"
          @click="handleNextPage"
        >
          {{ t('common.next') }}
        </Button>
      </nav>
    </section>

    <ConfirmDialog
      :open="confirmOpen"
      :title="t('tools.missingResources.confirm.title')"
      :description="confirmDescription"
      :confirm-label="t('tools.missingResources.confirm.action')"
      :busy="resources.cleaning.value"
      @confirm="handleConfirmClean"
      @cancel="handleCancelClean"
    />
  </div>
</template>
