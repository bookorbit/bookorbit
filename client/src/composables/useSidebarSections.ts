import { computed, type Component, type ComputedRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { Aperture, BookCopy, FolderOpen, Podcast } from '@lucide/vue'
import { APP_FEATURES, type LibraryType, type SidebarCappedSectionId } from '@bookorbit/types'
import type { SidebarEntity } from '@/components/sidebar/SidebarEntitySection.vue'
import { mediaOrderPersisters, type PersistOrder } from '@/components/sidebar/sidebar-order'
import { formatNumber } from '@/i18n/formatters'
import { useMediaMode } from '@/composables/useMediaMode'
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
  /** The media mode the section belongs to. */
  medium: LibraryType
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
    medium: 'books',
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
    medium: 'books',
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
    medium: 'books',
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
  {
    id: 'podcasts',
    kind: 'library',
    medium: 'podcasts',
    icon: Podcast,
    routeName: 'podcast-library',
    indexRouteName: 'podcast-libraries',
    copy: {
      label: 'components.sidebar.podcasts',
      empty: 'components.sidebar.noPodcastLibraries',
      filter: 'components.sidebar.filterPodcastLibraries',
      filterPlaceholder: 'components.sidebar.filterPodcastLibrariesPlaceholder',
      seeAll: 'components.sidebar.seeAllPodcastLibraries',
      add: 'components.sidebar.newPodcastLibrary',
    },
  },
  {
    id: 'podcastScopes',
    kind: 'smartScope',
    medium: 'podcasts',
    icon: Aperture,
    routeName: 'podcast-playlist',
    copy: {
      label: 'components.sidebar.playlists',
      empty: 'components.sidebar.noPlaylists',
      filter: 'components.sidebar.filterPlaylists',
      filterPlaceholder: 'components.sidebar.filterPlaylistsPlaceholder',
      seeAll: 'components.sidebar.seeAllPlaylists',
      add: 'components.sidebar.newPlaylist',
    },
  },
  {
    id: 'podcastCollections',
    kind: 'collection',
    medium: 'podcasts',
    icon: FolderOpen,
    routeName: 'podcast-collection',
    copy: {
      label: 'components.sidebar.collections',
      empty: 'components.sidebar.noPodcastCollections',
      filter: 'components.sidebar.filterPodcastCollections',
      filterPlaceholder: 'components.sidebar.filterPodcastCollectionsPlaceholder',
      seeAll: 'components.sidebar.seeAllPodcastCollections',
      add: 'components.sidebar.newPodcastCollection',
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
  medium: LibraryType
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
  const { mode } = useMediaMode()
  const { hasPermission } = usePermissions()
  const { libraries, reorderLibraries } = useLibraries()
  const { bookScopes, podcastScopes, reorderSmartScopes } = useSmartScopes()
  const { bookCollections, podcastCollections, reorderCollections } = useCollections()
  const { activityFor } = useSidebarLibraryActivity()

  const bookLibraries = computed(() => libraries.value.filter((library) => library.type !== 'podcasts'))
  const podcastLibraries = computed(() => libraries.value.filter((library) => library.type === 'podcasts'))
  /** Books-only users never see the mode switcher; the library creator is their entry point into podcasts. */
  const podcastsAvailable = computed(() => APP_FEATURES.podcasts && podcastLibraries.value.length > 0)
  const canManageLibraries = computed(() => hasPermission('manage_libraries'))

  const lists: Record<SidebarListKind, Record<LibraryType, ComputedRef<SidebarEntity[]>>> = {
    library: { books: bookLibraries, podcasts: podcastLibraries },
    smartScope: { books: bookScopes, podcasts: podcastScopes },
    collection: { books: bookCollections, podcasts: podcastCollections },
  }

  // Shared scopes and collections belong to their owner, so their display order is not this user's to persist.
  const persistOrder: Record<SidebarListKind, Record<LibraryType, PersistOrder>> = {
    library: mediaOrderPersisters({
      books: () => bookLibraries.value,
      podcasts: () => podcastLibraries.value,
      reorder: reorderLibraries,
    }),
    smartScope: mediaOrderPersisters({
      books: () => bookScopes.value.filter((scope) => scope.isOwner),
      podcasts: () => podcastScopes.value.filter((scope) => scope.isOwner),
      reorder: reorderSmartScopes,
    }),
    collection: mediaOrderPersisters({
      books: () => bookCollections.value.filter(canMutateCollection),
      podcasts: () => podcastCollections.value.filter(canMutateCollection),
      reorder: reorderCollections,
    }),
  }

  function activeIdFor(routeName: string): number | null {
    const id = route.params.id
    return route.name === routeName && id ? Number(id) : null
  }

  function canAdd(definition: SidebarSectionDefinition): boolean {
    if (definition.kind === 'library') return canManageLibraries.value
    return definition.medium === 'books' || podcastsAvailable.value
  }

  function resolve(definition: SidebarSectionDefinition): SidebarSection {
    const items = lists[definition.kind][definition.medium].value
    const isLibrary = definition.kind === 'library'
    return {
      id: definition.id,
      kind: definition.kind,
      medium: definition.medium,
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
        canAdd: canAdd(definition),
        addLabel: t(definition.copy.add),
      },
      tourId: definition.tourId,
      canReorder: isLibrary ? canManageLibraries.value : true,
      persistOrder: persistOrder[definition.kind][definition.medium],
      activity: isLibrary ? activityFor : undefined,
    }
  }

  const sections = computed(() => SIDEBAR_SECTIONS.filter((definition) => definition.medium === mode.value).map(resolve))

  return { sections, podcastLibraries, podcastsAvailable }
}
