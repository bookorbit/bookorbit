<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import BrowseFilterControl from '@/components/browse-header/BrowseFilterControl.vue'
import BrowseSearchField from '@/components/browse-header/BrowseSearchField.vue'
import BrowseSortControl from '@/components/browse-header/BrowseSortControl.vue'
import BrowseViewControls from '@/components/browse-header/BrowseViewControls.vue'
import { barDivider } from '@/components/browse-header/browse-header'
import ViewHeaderDisplayControls from '@/components/view-header/ViewHeaderDisplayControls.vue'
import BookShuffleButton from '@/features/book/components/BookShuffleButton.vue'
import TableColumnPanel from '@/features/book/components/TableColumnPanel.vue'
import FilterPanel from '@/features/book/components/sort-filter/FilterPanel.vue'
import SortPanel from '@/features/book/components/sort-filter/SortPanel.vue'
import type { BookListPage } from '@/features/book/composables/useBookListPage'

/**
 * A book listing's command bar: search, sort, filters, the host's own facets in `extras`, then
 * selection and view controls. Renders as a fragment so the header bar lays its controls out
 * exactly as if the host had written them inline.
 */
withDefaults(
  defineProps<{
    page: BookListPage
    searchPlaceholder?: string
    filterMaxDepth?: number
    /** Offers the sorts that only make sense inside a collection, such as its manual order. */
    collectionScopedSort?: boolean
  }>(),
  { searchPlaceholder: undefined, filterMaxDepth: undefined, collectionScopedSort: false },
)

defineSlots<{ extras?: () => unknown }>()

const { t } = useI18n()
</script>

<template>
  <BrowseSearchField
    :model-value="page.searchQuery"
    :placeholder="searchPlaceholder ?? t('views.bookView.searchPlaceholder')"
    :tokens="page.filterTokens"
    :join="page.filterJoin"
    :active="page.isNarrowed"
    @update:model-value="page.setSearchQuery"
    @remove-token="page.removeFilterToken"
    @edit-token="page.editFilterToken"
    @set-join="page.setFilterJoin"
    @clear="page.clearAll"
    @open-filters="page.openFilterPanel"
  />
  <span :class="barDivider" aria-hidden="true" />
  <BrowseSortControl
    v-if="page.effectiveViewMode !== 'table'"
    :label="page.sortLabel"
    :direction="page.sortDirection"
    :changed="!page.isDefaultSort"
    popover-class=""
    phone-sheet
    :extra-levels="page.sortExtraLevels"
    :direction-label="page.sortDirectionLabel"
    :next-direction-label="page.sortNextDirectionLabel"
    :hide-direction="page.sortIsRandom"
    @toggle-direction="page.toggleSortDirection"
  >
    <SortPanel
      :model-value="page.tableSortModel"
      :default-sort="page.defaultSortSpec"
      :collection-scoped="collectionScopedSort"
      @update:model-value="page.setSortModel"
      @shuffle="page.reshuffle"
    />
  </BrowseSortControl>
  <BookShuffleButton v-if="page.randomSortActive" desktop-only compact @shuffle="page.reshuffle" />
  <BrowseFilterControl :open="page.filterOpen" :count="page.filterRuleCount" :anchor="page.filterAnchor" @update:open="page.setFilterOpen">
    <FilterPanel
      :model-value="page.filter"
      :view="page.filterView"
      :match-count="page.filterMatchCount"
      :max-depth="filterMaxDepth"
      @update:model-value="page.setFilter"
      @close="page.closeFilterPanel"
    />
  </BrowseFilterControl>
  <slot name="extras" />
  <span :class="barDivider" aria-hidden="true" />
  <BrowseViewControls
    :view-mode="page.viewMode"
    :selection-mode="page.selectionMode"
    :display-wide="page.effectiveViewMode === 'table'"
    @update:view-mode="page.setViewMode"
    @toggle-selection="page.toggleSelectionMode"
  >
    <template #display>
      <ViewHeaderDisplayControls
        :view-mode="page.effectiveViewMode"
        :cover-size="page.coverSize"
        :grid-gap="page.gridGap"
        show-jump-rail-toggle
        :show-jump-rails="page.showJumpRails"
        show-collapse-series
        :collapse-series="page.effectiveCollapseEnabled"
        :collapse-series-locked="page.selectionMode"
        @update:cover-size="page.handleCoverSizeUpdate"
        @update:grid-gap="page.handleGridGapUpdate"
        @update:show-jump-rails="page.handleShowJumpRailsUpdate"
        @update:collapse-series="page.handleCollapseSeriesUpdate"
      >
        <template #columns>
          <TableColumnPanel
            v-if="page.tableRef"
            :all-columns="page.tableRef.allColumns"
            :all-presets="page.tableRef.allPresets"
            :saved-views="page.allSavedViews"
            :table-density="page.tableDensity"
            @toggle-column="page.handleToggleColumn"
            @reorder-columns="page.handleColumnPanelReorder"
            @apply-preset="page.handleApplyTablePreset"
            @save-preset="page.handleSaveTablePreset"
            @delete-preset="page.handleDeleteTablePreset"
            @rename-preset="page.handleRenameTablePreset"
            @duplicate-preset="page.handleDuplicateTablePreset"
            @favorite-preset="page.handleTogglePresetFavorite"
            @apply-view="page.handleApplySavedView"
            @save-view="page.handleSaveCurrentView"
            @delete-view="page.deleteView"
            @rename-view="page.renameView"
            @duplicate-view="page.duplicateView"
            @favorite-view="page.toggleFavorite"
            @update:density="page.handleTableDensityChange"
            @export-backup="page.handleExportTableBackup"
            @import-backup="page.handleImportTableBackup"
            @reset="page.handleResetColumns"
          />
        </template>
      </ViewHeaderDisplayControls>
    </template>
  </BrowseViewControls>
</template>
