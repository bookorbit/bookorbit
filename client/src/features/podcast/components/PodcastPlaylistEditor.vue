<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, ListFilter, LoaderCircle, Search } from '@lucide/vue'
import {
  PODCAST_PLAYLIST_MAX_DURATION_MINUTES,
  PODCAST_PLAYLIST_MAX_PUBLISHED_WITHIN_DAYS,
  PODCAST_PLAYLIST_MAX_SHOWS,
  type PodcastEpisodeFilter,
  type PodcastListItem,
  type PodcastPlaylistSort,
} from '@bookorbit/types'
import { api } from '@/lib/api'
import { createRequestGeneration } from '@/lib/async'
import { formatNumber } from '@/i18n/formatters'
import { Button } from '@/components/ui/button'
import Chip from '@/components/ui/Chip.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import FormSheet from '@/components/FormSheet.vue'
import { DEFAULT_PLAYLIST_RULES, normalizePlaylistRules } from '../lib/podcast-playlist-rules'
import { PODCAST_EPISODE_FILTER_OPTIONS, PODCAST_EPISODE_SORT_OPTIONS } from '../lib/podcast-episode-filters'
import { formatPodcastDuration } from '../lib/podcast-format'
import { usePodcastPlaylistPreview } from '../composables/usePodcastPlaylistPreview'
import type { PodcastPlaylistOption } from '../composables/usePodcastPlaylists'

const SEARCH_DEBOUNCE_MS = 300
const SHOW_RESULT_SIZE = 8

const props = defineProps<{
  open: boolean
  libraryId: number
  playlist: PodcastPlaylistOption | null
  saving: boolean
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  save: [payload: { id?: string; name: string; rules: ReturnType<typeof normalizePlaylistRules> }]
  delete: [id: string]
}>()

const { t } = useI18n()
const name = ref('')
const rules = ref(normalizePlaylistRules(DEFAULT_PLAYLIST_RULES))
const showSearch = ref('')
const showResults = ref<PodcastListItem[]>([])
const selectedShows = ref<PodcastListItem[]>([])
const searching = ref(false)
const formError = ref<string | null>(null)
const snapshot = ref('')
const confirmingDelete = ref(false)

let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null
const searchGeneration = createRequestGeneration()

onScopeDispose(() => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
})

const {
  count: previewCount,
  durationSeconds: previewDuration,
  loading: previewLoading,
  failed: previewFailed,
} = usePodcastPlaylistPreview({
  libraryId: computed(() => props.libraryId),
  rules,
  active: computed(() => props.open),
})

const isEditing = computed(() => Boolean(props.playlist && !props.playlist.builtIn))
const title = computed(() => t(`podcast.playlists.${isEditing.value ? 'editTitle' : 'createTitle'}`))
const previewSummary = computed(() =>
  t('podcast.playlists.summary', { count: formatNumber(previewCount.value ?? 0), duration: formatPodcastDuration(previewDuration.value) }),
)
const canAddShow = computed(() => rules.value.podcastIds.length < PODCAST_PLAYLIST_MAX_SHOWS)
const isDirty = computed(() => draftSnapshot() !== snapshot.value)
const filterOptions = computed<Array<{ value: PodcastEpisodeFilter; label: string }>>(() =>
  PODCAST_EPISODE_FILTER_OPTIONS.map((option) => ({ value: option.id, label: t(option.labelKey) })),
)
const sortOptions = computed<Array<{ value: PodcastPlaylistSort; label: string }>>(() =>
  PODCAST_EPISODE_SORT_OPTIONS.map((option) => ({ value: option.id, label: t(option.labelKey) })),
)

function draftSnapshot(): string {
  return JSON.stringify({ name: name.value.trim(), rules: rules.value })
}

function handleOpened() {
  formError.value = null
  showSearch.value = ''
  showResults.value = []
  const source = props.playlist
  name.value = source && !source.builtIn ? source.name : source ? t('podcast.playlists.copyOf', { name: source.name }) : ''
  rules.value = normalizePlaylistRules(source?.rules ?? DEFAULT_PLAYLIST_RULES)
  snapshot.value = draftSnapshot()
  void loadSelectedShows(rules.value.podcastIds)
}

// The confirmation is a sibling of the sheet rather than a child, so closing the sheet has to take
// it along; an orphaned prompt would otherwise delete a playlist from an editor already dismissed.
watch(
  () => props.open,
  (open) => {
    if (!open) confirmingDelete.value = false
  },
)

watch(showSearch, (value) => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  searchDebounceTimer = setTimeout(() => {
    searchDebounceTimer = null
    void searchShows(value)
  }, SEARCH_DEBOUNCE_MS)
})

/** Resolves the saved show ids to titles in one bounded request rather than one lookup per chip. */
async function loadSelectedShows(podcastIds: number[]) {
  if (podcastIds.length === 0) {
    selectedShows.value = []
    return
  }
  const generation = searchGeneration.begin()
  const params = new URLSearchParams({ size: String(PODCAST_PLAYLIST_MAX_SHOWS), podcastIds: podcastIds.join(',') })
  const response = await api(`/api/v1/podcast-libraries/${props.libraryId}/podcasts?${params}`)
  if (!response.ok || !searchGeneration.isCurrent(generation)) return
  const result: { items: PodcastListItem[] } = await response.json()
  selectedShows.value = result.items
}

async function searchShows(term: string) {
  const query = term.trim()
  if (!query) {
    showResults.value = []
    return
  }
  const generation = searchGeneration.begin()
  searching.value = true
  try {
    const params = new URLSearchParams({ size: String(SHOW_RESULT_SIZE), q: query })
    const response = await api(`/api/v1/podcast-libraries/${props.libraryId}/podcasts?${params}`)
    if (!response.ok || !searchGeneration.isCurrent(generation)) return
    const result: { items: PodcastListItem[] } = await response.json()
    showResults.value = result.items
  } finally {
    if (searchGeneration.isCurrent(generation)) searching.value = false
  }
}

function addShow(show: PodcastListItem) {
  if (rules.value.podcastIds.includes(show.id) || !canAddShow.value) return
  rules.value.podcastIds = [...rules.value.podcastIds, show.id]
  selectedShows.value = [...selectedShows.value, show]
}

function removeShow(showId: number) {
  rules.value.podcastIds = rules.value.podcastIds.filter((id) => id !== showId)
  selectedShows.value = selectedShows.value.filter((show) => show.id !== showId)
}

/**
 * An empty or non-positive field means "no bound", which the rules express as null. Anything above
 * the field's ceiling is held at it: the preview counts on every edit, so a rule the server would
 * reject has to never reach it rather than be caught at save time.
 */
function setPositiveRule(field: 'minDurationMinutes' | 'maxDurationMinutes' | 'publishedWithinDays', value: string | number, max: number) {
  const parsed = Number(value)
  rules.value[field] = Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), max) : null
}

function handleMinDuration(value: string | number) {
  setPositiveRule('minDurationMinutes', value, PODCAST_PLAYLIST_MAX_DURATION_MINUTES)
}

function handleMaxDuration(value: string | number) {
  setPositiveRule('maxDurationMinutes', value, PODCAST_PLAYLIST_MAX_DURATION_MINUTES)
}

function handlePublishedWithin(value: string | number) {
  setPositiveRule('publishedWithinDays', value, PODCAST_PLAYLIST_MAX_PUBLISHED_WITHIN_DAYS)
}

function handleOpenChange(open: boolean) {
  emit('update:open', open)
}

function handleSubmit() {
  const trimmed = name.value.trim()
  if (!trimmed) {
    formError.value = t('podcast.errors.playlistNameRequired')
    return
  }
  if (rules.value.minDurationMinutes && rules.value.maxDurationMinutes && rules.value.minDurationMinutes > rules.value.maxDurationMinutes) {
    formError.value = t('podcast.errors.playlistDurationRange')
    return
  }
  formError.value = null
  // Saving is the parent's job, so the sheet drops its dirty state now rather than prompting to
  // discard the very edits it just handed over.
  snapshot.value = draftSnapshot()
  emit('save', { ...(isEditing.value && props.playlist ? { id: props.playlist.id } : {}), name: trimmed, rules: rules.value })
}

function handleDelete() {
  if (props.playlist && !props.playlist.builtIn) confirmingDelete.value = true
}

function cancelDelete() {
  confirmingDelete.value = false
}

/** Rules are not recoverable once the playlist is gone, so the sheet asks before handing the delete up. */
function confirmDelete() {
  confirmingDelete.value = false
  if (props.playlist && !props.playlist.builtIn) emit('delete', props.playlist.id)
}
</script>

<template>
  <FormSheet
    :open="open"
    :title="title"
    :description="t('podcast.playlists.editorDescription')"
    content-class="sm:max-w-lg"
    :reset-key="playlist?.id ?? ''"
    :busy="saving"
    :dirty="isDirty"
    :error="formError"
    :submit-label="t('podcast.playlists.save')"
    @update:open="handleOpenChange"
    @opened="handleOpened"
    @submit="handleSubmit"
  >
    <div class="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4">
      <!-- Pinned rather than inline: the rules that move this number sit further down the form, and
           a count that scrolls away stops being a preview of the edit being made. -->
      <div
        class="sticky top-0 z-10 -mx-4 flex items-center gap-2 border-b border-border bg-background px-4 py-2"
        role="status"
        data-testid="podcast-playlist-preview"
      >
        <ListFilter class="size-3.5 shrink-0 text-primary" aria-hidden="true" />
        <template v-if="previewLoading">
          <LoaderCircle class="size-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden="true" />
          <span class="text-xs text-muted-foreground">{{ t('common.loading') }}</span>
        </template>
        <span v-else-if="previewFailed" class="text-xs text-muted-foreground">{{ t('podcast.errors.loadEpisodes') }}</span>
        <span v-else-if="previewCount === 0" class="text-xs text-muted-foreground">{{ t('podcast.playlists.empty') }}</span>
        <span v-else-if="previewCount !== null" class="text-xs font-medium text-foreground tabular-nums">{{ previewSummary }}</span>
      </div>

      <label class="block text-xs font-medium" for="podcast-playlist-name">
        {{ t('podcast.playlists.nameLabel') }}
        <Input
          id="podcast-playlist-name"
          v-model="name"
          type="text"
          maxlength="80"
          required
          class="mt-1.5"
          :placeholder="t('podcast.playlists.namePlaceholder')"
        />
      </label>

      <div class="grid gap-3 sm:grid-cols-2">
        <label class="block text-xs font-medium" for="podcast-playlist-filter">
          {{ t('podcast.playlists.filterLabel') }}
          <Select id="podcast-playlist-filter" v-model="rules.filter" class="mt-1.5">
            <option v-for="option in filterOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
          </Select>
        </label>
        <label class="block text-xs font-medium" for="podcast-playlist-sort">
          {{ t('podcast.playlists.sortLabel') }}
          <Select id="podcast-playlist-sort" v-model="rules.sort" class="mt-1.5">
            <option v-for="option in sortOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
          </Select>
        </label>
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <label class="block text-xs font-medium" for="podcast-playlist-min">
          {{ t('podcast.playlists.minDuration') }}
          <Input
            id="podcast-playlist-min"
            type="number"
            min="1"
            :max="PODCAST_PLAYLIST_MAX_DURATION_MINUTES"
            inputmode="numeric"
            class="mt-1.5"
            :model-value="rules.minDurationMinutes ?? ''"
            @update:model-value="handleMinDuration"
          />
        </label>
        <label class="block text-xs font-medium" for="podcast-playlist-max">
          {{ t('podcast.playlists.maxDuration') }}
          <Input
            id="podcast-playlist-max"
            type="number"
            min="1"
            :max="PODCAST_PLAYLIST_MAX_DURATION_MINUTES"
            inputmode="numeric"
            class="mt-1.5"
            :model-value="rules.maxDurationMinutes ?? ''"
            @update:model-value="handleMaxDuration"
          />
        </label>
      </div>

      <label class="block text-xs font-medium" for="podcast-playlist-published">
        {{ t('podcast.playlists.publishedWithin') }}
        <Input
          id="podcast-playlist-published"
          type="number"
          min="1"
          :max="PODCAST_PLAYLIST_MAX_PUBLISHED_WITHIN_DAYS"
          inputmode="numeric"
          class="mt-1.5"
          :model-value="rules.publishedWithinDays ?? ''"
          @update:model-value="handlePublishedWithin"
        />
      </label>

      <label class="flex items-center gap-2 text-xs font-medium">
        <input v-model="rules.followedOnly" type="checkbox" class="h-4 w-4 accent-primary" />
        {{ t('podcast.library.followedOnly') }}
      </label>

      <fieldset>
        <legend class="block text-xs font-medium">{{ t('podcast.playlists.showsLabel') }}</legend>
        <p class="mt-1 text-xs leading-5 text-muted-foreground">{{ t('podcast.playlists.showsDescription') }}</p>
        <div v-if="selectedShows.length" class="mt-2 flex flex-wrap gap-1.5">
          <Chip
            v-for="show in selectedShows"
            :key="show.id"
            variant="primary"
            removable
            :remove-label="t('podcast.playlists.removeShow', { title: show.title })"
            @remove="removeShow(show.id)"
          >
            {{ show.title }}
          </Chip>
        </div>
        <div class="relative mt-2">
          <Search class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            v-model="showSearch"
            type="search"
            class="pl-8"
            :disabled="!canAddShow"
            :placeholder="t('podcast.playlists.searchShows')"
            :aria-label="t('podcast.playlists.searchShows')"
          />
        </div>
        <p v-if="!canAddShow" class="mt-1.5 text-xs text-warning">{{ t('podcast.playlists.showLimit', { count: PODCAST_PLAYLIST_MAX_SHOWS }) }}</p>
        <div v-if="searching" class="mt-2 flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <LoaderCircle class="size-3.5 animate-spin motion-reduce:animate-none" />
          {{ t('common.loading') }}
        </div>
        <ul v-else-if="showResults.length" class="mt-2 space-y-0.5">
          <li v-for="show in showResults" :key="show.id">
            <button
              type="button"
              class="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              @click="addShow(show)"
            >
              <span class="min-w-0 truncate">{{ show.title }}</span>
              <Check v-if="rules.podcastIds.includes(show.id)" :size="14" class="shrink-0 text-primary" />
            </button>
          </li>
        </ul>
      </fieldset>
    </div>

    <template #footer-start>
      <Button
        v-if="isEditing"
        variant="outline"
        class="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
        :disabled="saving"
        @click="handleDelete"
      >
        {{ t('podcast.playlists.delete') }}
      </Button>
    </template>
  </FormSheet>

  <ConfirmDialog
    :open="confirmingDelete"
    :title="t('podcast.playlists.deleteConfirmTitle')"
    :description="t('podcast.playlists.deleteConfirmDescription', { name: playlist?.name ?? '' })"
    :confirm-label="t('podcast.playlists.delete')"
    :busy="saving"
    @confirm="confirmDelete"
    @cancel="cancelDelete"
  />
</template>
