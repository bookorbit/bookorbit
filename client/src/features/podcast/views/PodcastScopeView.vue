<script setup lang="ts">
import { computed, provide, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
import type { PodcastEpisodeListItem } from '@bookorbit/types'
import EmptyState from '@/components/EmptyState.vue'
import EntityNotFound from '@/components/EntityNotFound.vue'
import AppIcon from '@/components/AppIcon.vue'
import { formatNumber } from '@/i18n/formatters'
import { podcastScopeRules, Permission, type PodcastScopeRules } from '@bookorbit/types'
import { useSmartScopes } from '@/features/smart-scope/composables/useSmartScopes'
import { mediaModeHome } from '@/composables/useMediaMode'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { usePagedEntityMembers } from '@/composables/usePagedEntityMembers'
import { normalizePlaylistRules } from '@/features/podcast/lib/podcast-playlist-rules'
import PodcastPlaylistEditor from '@/features/podcast/components/PodcastPlaylistEditor.vue'
import PodcastPlaylistRuleSummary from '@/features/podcast/components/PodcastPlaylistRuleSummary.vue'
import type { PodcastPlaylistOption } from '@/features/podcast/composables/usePodcastPlaylists'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { usePodcastPlayer } from '@/features/podcast/composables/usePodcastPlayer'
import PodcastEpisodeRow from '@/features/podcast/components/PodcastEpisodeRow.vue'
import { PODCAST_EPISODE_ACTIONS, usePodcastEpisodeListActions } from '@/features/podcast/composables/usePodcastEpisodeListActions'
import { Pencil } from '@lucide/vue'
import { toast } from 'vue-sonner'

/**
 * Podcast smart scopes are surfaced to users as playlists, the term the podcast world already
 * uses and that the library tab has always used. The stored row is still a smart_scopes row with
 * media_type='podcasts'; only the vocabulary differs.
 */
defineOptions({ name: 'PodcastScopeView' })

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const {
  smartScopes,
  loaded: scopesLoaded,
  error: scopesError,
  fetchSmartScopes,
  refreshSmartScopes,
  updateSmartScope,
  deleteSmartScope,
  fetchScopeEpisodes,
  applyScopeEpisodeCount,
} = useSmartScopes()
const { hasPermission } = usePermissions()
const { libraries } = useLibraries()
const player = usePodcastPlayer()

const scopeId = computed(() => Number(route.params.id))
const scope = computed(() => smartScopes.value.find((candidate) => candidate.id === scopeId.value && candidate.mediaType === 'podcasts') ?? null)

const {
  items: episodes,
  total,
  loading,
  notFound,
  error,
  appendError,
  sentinel,
  load,
  loadMore,
} = usePagedEntityMembers<(typeof smartScopes.value)[number], PodcastEpisodeListItem>({
  entityId: scopeId,
  entity: scope,
  loaded: scopesLoaded,
  listError: scopesError,
  fetchEntities: fetchSmartScopes,
  refreshEntities: refreshSmartScopes,
  fetchPage: fetchScopeEpisodes,
  applyTotal: applyScopeEpisodeCount,
  errorKeys: { load: 'views.podcastScope.loadFailed', loadMore: 'views.podcastScope.loadMoreFailed' },
})

const canDownload = computed(() => hasPermission(Permission.PodcastDownload))
const canEdit = computed(() => scope.value?.isOwner === true)

const editorOpen = ref(false)
const savingRules = ref(false)

const summaryRules = computed(() => (scope.value ? normalizePlaylistRules(podcastScopeRules(scope.value) ?? {}) : null))

/** The scope's stored rules, shaped as the playlist editor's option so it can be reused as-is. */
const editorPlaylist = computed<PodcastPlaylistOption | null>(() =>
  scope.value && summaryRules.value ? { id: String(scope.value.id), name: scope.value.name, rules: summaryRules.value, builtIn: false } : null,
)

provide(PODCAST_EPISODE_ACTIONS, usePodcastEpisodeListActions())

function openEditor(): void {
  editorOpen.value = true
}

function setEditorOpen(open: boolean): void {
  editorOpen.value = open
}

async function saveRules(payload: { name: string; rules: PodcastScopeRules }): Promise<void> {
  if (!scope.value) return
  savingRules.value = true
  try {
    await updateSmartScope(scope.value.id, { name: payload.name, filter: payload.rules })
    editorOpen.value = false
    await load()
  } catch {
    toast.error(t('views.podcastScope.saveFailed'))
  } finally {
    savingRules.value = false
  }
}

async function deleteScope(): Promise<void> {
  if (!scope.value) return
  try {
    const podcastLibraries = libraries.value.filter((library) => library.type === 'podcasts')
    await deleteSmartScope(scope.value.id)
    editorOpen.value = false
    // Stay in the medium the user is browsing; the books dashboard would leave the sidebar
    // showing podcast navigation around book content.
    await router.push(mediaModeHome('podcasts', podcastLibraries))
  } catch {
    toast.error(t('views.podcastScope.deleteFailed'))
  }
}

function isActive(episode: PodcastEpisodeListItem): boolean {
  return player.episode.value?.id === episode.id
}
</script>

<template>
  <div class="h-full">
    <EntityNotFound v-if="notFound" :entity="t('views.podcastScope.entity')" />

    <div v-else class="flex h-full flex-col gap-3">
      <header class="flex min-w-0 items-center gap-2 px-2">
        <AppIcon :icon="scope?.icon || 'Aperture'" fallback="Aperture" :size="18" class="shrink-0 text-primary" />
        <h1 class="min-w-0 truncate text-lg font-semibold text-foreground">{{ scope?.name ?? t('views.podcastScope.title') }}</h1>
        <span class="shrink-0 text-sm text-muted-foreground tabular-nums">{{ formatNumber(total) }}</span>
        <button
          v-if="canEdit"
          type="button"
          class="ml-auto inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-(--shell-accent-line) px-2.5 text-[13px] font-medium text-foreground outline-hidden transition-colors duration-150 hover:bg-(--shell-accent-wash) focus-visible:ring-2 focus-visible:ring-ring"
          @click="openEditor"
        >
          <Pencil :size="13" aria-hidden="true" />
          {{ t('views.podcastScope.editRules') }}
        </button>
      </header>

      <!-- The rules a playlist collects by, stated on the page. Owners get the whole row as the way
           into the editor, so the chips stay a button rather than a clickable div. -->
      <button
        v-if="summaryRules && canEdit"
        type="button"
        class="flex min-w-0 flex-wrap items-center gap-1.5 rounded-md px-2 text-start outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        @click="openEditor"
      >
        <PodcastPlaylistRuleSummary :rules="summaryRules" />
        <span class="sr-only">{{ t('views.podcastScope.editRules') }}</span>
      </button>
      <div v-else-if="summaryRules" class="flex min-w-0 flex-wrap items-center gap-1.5 px-2">
        <PodcastPlaylistRuleSummary :rules="summaryRules" />
      </div>

      <p v-if="error" class="px-2 text-sm text-destructive" role="alert">{{ error }}</p>

      <EmptyState
        v-else-if="!loading && episodes.length === 0"
        icon="Aperture"
        :title="t('views.podcastScope.empty.title')"
        :hint="t('views.podcastScope.empty.hint')"
      />

      <div v-else class="flex flex-col gap-1">
        <!-- A scope can match a whole library, and infinite scroll accumulates every page it has
             loaded, so these rows are virtualized the way the show and library lists are. -->
        <DynamicScroller page-mode :items="episodes" :min-item-size="80" key-field="id">
          <template #default="{ item, index, active }">
            <DynamicScrollerItem :item="item" :active="active" :data-index="index" class="pb-1">
              <PodcastEpisodeRow
                :episode="item"
                :can-download="canDownload"
                :is-active="isActive(item)"
                :is-playing="isActive(item) && player.isPlaying.value"
              />
            </DynamicScrollerItem>
          </template>
        </DynamicScroller>
        <p v-if="appendError" class="px-2 py-1 text-[13px] text-muted-foreground" role="alert">
          {{ appendError }}
          <button type="button" class="ml-1 font-medium text-primary underline underline-offset-2" @click="loadMore">
            {{ t('views.podcastScope.retry') }}
          </button>
        </p>
      </div>

      <!-- Outside the branches above: the observer attaches once on mount, so the sentinel has to
         exist from the first render or paging never starts. It needs real height too, because a
         1px marker sits exactly on the scroll container's clipped edge and never reads as visible. -->
      <div ref="sentinel" class="h-8 w-full shrink-0" aria-hidden="true" />

      <PodcastPlaylistEditor
        v-if="scope && scope.libraryId !== null"
        :open="editorOpen"
        :library-id="scope.libraryId"
        :playlist="editorPlaylist"
        :saving="savingRules"
        @update:open="setEditorOpen"
        @save="saveRules"
        @delete="deleteScope"
      />
    </div>
  </div>
</template>
