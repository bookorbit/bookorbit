import { computed, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { Aperture, BookCopy, FolderOpen } from '@lucide/vue'
import type { SidebarCappedSectionId } from '@bookorbit/types'
import type { SidebarEntity } from '@/components/sidebar/SidebarEntitySection.vue'
import { orderPersister, type PersistOrder } from '@/components/sidebar/sidebar-order'
import { formatNumber } from '@/i18n/formatters'
import { useSidebarLibraryActivity, type SidebarItemActivity } from '@/composables/useSidebarLibraryActivity'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { useSmartScopes } from '@/features/smart-scope/composables/useSmartScopes'
import { useCollections } from '@/features/collection/composables/useCollections'
import { canMutateCollection } from '@/features/collection/lib/collection-access'

export type SidebarListKind = 'library' | 'smartScope' | 'collection'

interface SidebarSectionDefinition {
  id: SidebarCappedSectionId
  kind: SidebarListKind
  icon: Component
  routeName: string
  /** Omit when the section has no index page; the see-all link is then suppressed. */
  indexRouteName?: string
  tourId?: string
  copy: {
    label: string
    empty: string
    filter: string
    filterPlaceholder: string
    seeAll: string
    add: string
  }
}

export const SIDEBAR_SECTIONS: readonly SidebarSectionDefinition[] = [
  {
    id: 'libraries',
    kind: 'library',
    icon: BookCopy,
    routeName: 'library',
    indexRouteName: 'libraries',
    tourId: 'sidebar-libraries',
    copy: {
      label: 'components.sidebar.libraries',
      empty: 'components.sidebar.noLibraries',
      filter: 'components.sidebar.filterLibraries',
      filterPlaceholder: 'components.sidebar.filterLibrariesPlaceholder',
      seeAll: 'components.sidebar.seeAllLibraries',
      add: 'components.sidebar.newLibrary',
    },
  },
  {
    id: 'smartScopes',
    kind: 'smartScope',
    icon: Aperture,
    routeName: 'smartScope',
    indexRouteName: 'smart-scopes',
    tourId: 'sidebar-smartScopes',
    copy: {
      label: 'components.sidebar.smartScopes',
      empty: 'components.sidebar.noSmartScopes',
      filter: 'components.sidebar.filterSmartScopes',
      filterPlaceholder: 'components.sidebar.filterSmartScopesPlaceholder',
      seeAll: 'components.sidebar.seeAllSmartScopes',
      add: 'components.sidebar.newSmartScope',
    },
  },
  {
    id: 'collections',
    kind: 'collection',
    icon: FolderOpen,
    routeName: 'collection',
    indexRouteName: 'collections',
    tourId: 'sidebar-collections',
    copy: {
      label: 'components.sidebar.collections',
      empty: 'components.sidebar.noCollections',
      filter: 'components.sidebar.filterCollections',
      filterPlaceholder: 'components.sidebar.filterCollectionsPlaceholder',
      seeAll: 'components.sidebar.seeAllCollections',
      add: 'components.sidebar.newCollection',
    },
  },
]

/** What a section passes to SidebarEntitySection in both the expanded list and the rail popover. */
export interface SidebarSectionProps {
  sectionId: SidebarCappedSectionId
  label: string
  items: SidebarEntity[]
  routeName: string
  indexRouteName?: string
  activeId: number | null
  fallbackIcon: Component
  emptyText: string
  filterLabel: string
  filterPlaceholder: string
  seeAllLabel: string
  canAdd: boolean
  addLabel: string
}

export interface SidebarSection {
  id: SidebarCappedSectionId
  kind: SidebarListKind
  icon: Component
  props: SidebarSectionProps
  /** The rest is expanded-list only: rail popovers neither reorder, anchor the tour, nor show progress. */
  tourId?: string
  canReorder: boolean
  persistOrder: PersistOrder
  activity?: (item: SidebarEntity) => SidebarItemActivity | null
}

export function useSidebarSections() {
  const { t } = useI18n()
  const route = useRoute()
  const { hasPermission } = usePermissions()
  const { libraries, reorderLibraries } = useLibraries()
  const { smartScopes, reorderSmartScopes } = useSmartScopes()
  const { collections, reorderCollections } = useCollections()
  const { activityFor } = useSidebarLibraryActivity()

  const canManageLibraries = computed(() => hasPermission('manage_libraries'))

  const lists: Record<SidebarListKind, () => SidebarEntity[]> = {
    library: () => libraries.value,
    smartScope: () => smartScopes.value,
    collection: () => collections.value,
  }

  // Shared scopes and collections belong to their owner, so their display order is not this user's to persist.
  const persistOrder: Record<SidebarListKind, PersistOrder> = {
    library: orderPersister(() => libraries.value, reorderLibraries),
    smartScope: orderPersister(() => smartScopes.value.filter((scope) => scope.isOwner), reorderSmartScopes),
    collection: orderPersister(() => collections.value.filter(canMutateCollection), reorderCollections),
  }

  function activeIdFor(routeName: string): number | null {
    const id = route.params.id
    return route.name === routeName && id ? Number(id) : null
  }

  function resolve(definition: SidebarSectionDefinition): SidebarSection {
    const items = lists[definition.kind]()
    const isLibrary = definition.kind === 'library'
    return {
      id: definition.id,
      kind: definition.kind,
      icon: definition.icon,
      props: {
        sectionId: definition.id,
        label: t(definition.copy.label),
        items,
        routeName: definition.routeName,
        indexRouteName: definition.indexRouteName,
        activeId: activeIdFor(definition.routeName),
        fallbackIcon: definition.icon,
        emptyText: t(definition.copy.empty),
        filterLabel: t(definition.copy.filter),
        filterPlaceholder: t(definition.copy.filterPlaceholder),
        seeAllLabel: t(definition.copy.seeAll, { count: formatNumber(items.length) }),
        canAdd: isLibrary ? canManageLibraries.value : true,
        addLabel: t(definition.copy.add),
      },
      tourId: definition.tourId,
      canReorder: isLibrary ? canManageLibraries.value : true,
      persistOrder: persistOrder[definition.kind],
      activity: isLibrary ? activityFor : undefined,
    }
  }

  const sections = computed(() => SIDEBAR_SECTIONS.map(resolve))

  return { sections }
}
