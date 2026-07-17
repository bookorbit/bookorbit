<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Ban, Loader2, Plus, Search, Trash2 } from '@lucide/vue'
import type { MetadataFetchPreferences } from '@bookorbit/types'
import { useMetadataPreferences } from './composables/useMetadataPreferences'

const { t } = useI18n()
const { globalPrefs, loadingGlobal, savingGlobal, fetchGlobal, saveGlobal } = useMetadataPreferences()

const draftBlocklist = ref<string[]>([])
const newGenre = ref('')
const filterText = ref('')

onMounted(() => {
  fetchGlobal()
})

watch(
  globalPrefs,
  (prefs) => {
    const blocklist = normalizeBlocklist(prefs?.options?.genres.blocklist ?? [])
    draftBlocklist.value = [...blocklist]
  },
  { immediate: true },
)

const normalizedNewGenre = computed(() => newGenre.value.trim())
const newGenreToken = computed(() => normalizedNewGenre.value.toLowerCase())
const existingTokens = computed(() => new Set(draftBlocklist.value.map((genre) => genre.toLowerCase())))
const isDuplicate = computed(() => Boolean(newGenreToken.value) && existingTokens.value.has(newGenreToken.value))
const isBusy = computed(() => !globalPrefs.value || loadingGlobal.value || savingGlobal.value)
const canAdd = computed(() => Boolean(normalizedNewGenre.value) && !isDuplicate.value && !isBusy.value)
const filterToken = computed(() => filterText.value.trim().toLowerCase())
const filteredBlocklist = computed(() => {
  if (!filterToken.value) return draftBlocklist.value
  return draftBlocklist.value.filter((genre) => genre.toLowerCase().includes(filterToken.value))
})
const visibleCountLabel = computed(() => {
  if (!filterToken.value) return t('settings.metadata.genreBlocklist.entryCount', { count: draftBlocklist.value.length }, draftBlocklist.value.length)
  return t('settings.metadata.genreBlocklist.filteredCount', { shown: filteredBlocklist.value.length, total: draftBlocklist.value.length })
})

function normalizeBlocklist(values: readonly string[]): string[] {
  const blocklist: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed) continue
    const token = trimmed.toLowerCase()
    if (seen.has(token)) continue
    seen.add(token)
    blocklist.push(trimmed)
  }
  return blocklist
}

function withBlocklist(prefs: MetadataFetchPreferences, blocklist: string[]): MetadataFetchPreferences {
  return {
    ...prefs,
    options: {
      genres: {
        mode: prefs.options?.genres.mode ?? 'merge',
        blocklist,
      },
      saveProviderIds: prefs.options?.saveProviderIds ?? true,
    },
  }
}

async function persistBlocklist(resolveNextBlocklist: (latestBlocklist: string[]) => string[]): Promise<boolean> {
  const latestPrefs = await fetchGlobal()
  if (!latestPrefs) return false

  const nextBlocklist = normalizeBlocklist(resolveNextBlocklist(latestPrefs.options?.genres.blocklist ?? []))
  const previousBlocklist = draftBlocklist.value
  draftBlocklist.value = nextBlocklist
  let saved = false
  try {
    saved = await saveGlobal(withBlocklist(latestPrefs, nextBlocklist))
    return saved
  } finally {
    if (!saved) draftBlocklist.value = previousBlocklist
  }
}

async function addGenre() {
  if (!canAdd.value) return
  const genre = normalizedNewGenre.value
  newGenre.value = ''
  const saved = await persistBlocklist((latestBlocklist) => [...latestBlocklist, genre])
  if (!saved) newGenre.value = genre
}

async function removeGenre(genre: string) {
  if (isBusy.value) return
  await persistBlocklist((latestBlocklist) => latestBlocklist.filter((value) => value !== genre))
}

function removeGenreLabel(genre: string): string {
  return t('settings.metadata.genreBlocklist.removeLabel', { genre })
}
</script>

<template>
  <div class="border border-border rounded-lg bg-card overflow-hidden shadow-xs">
    <div class="px-4 py-3.5 md:px-5 md:py-4 border-b border-border flex flex-col md:flex-row md:items-center justify-between gap-4 bg-muted/30">
      <div class="flex items-start gap-3">
        <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Ban :size="16" />
        </div>
        <div>
          <span class="text-xs font-bold text-muted-foreground uppercase tracking-widest">{{ t('settings.metadata.genreBlocklist.heading') }}</span>
          <p class="settings-hint">{{ t('settings.metadata.genreBlocklist.hint') }}</p>
        </div>
      </div>
      <div v-if="savingGlobal" class="inline-flex h-8 items-center gap-2 text-xs font-medium text-muted-foreground">
        <Loader2 :size="14" class="animate-spin" />
        <span>{{ t('settings.metadata.genreBlocklist.saving') }}</span>
      </div>
    </div>

    <div v-if="loadingGlobal && !globalPrefs" class="px-6 py-12 flex items-center justify-center">
      <Loader2 :size="24" class="animate-spin text-muted-foreground" />
    </div>

    <div v-else class="p-4 md:p-5 space-y-5">
      <div class="grid gap-2 md:grid-cols-[1fr_auto]">
        <div>
          <label for="genre-blocklist-entry" class="sr-only">{{ t('settings.metadata.genreBlocklist.genreValueLabel') }}</label>
          <input
            id="genre-blocklist-entry"
            v-model="newGenre"
            class="w-full h-9 rounded-md border border-input bg-background px-3 text-sm outline-none transition-shadow focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
            :placeholder="t('settings.metadata.genreBlocklist.addPlaceholder')"
            @keydown.enter="addGenre"
          />
          <p v-if="isDuplicate" class="mt-1.5 text-xs text-destructive">{{ t('settings.metadata.genreBlocklist.duplicate') }}</p>
        </div>
        <button class="settings-btn-primary h-9 px-3 justify-center md:min-w-24" type="button" :disabled="!canAdd" @click="addGenre">
          <Loader2 v-if="savingGlobal" :size="14" class="animate-spin" />
          <Plus v-else :size="14" />
          <span>{{ t('settings.metadata.genreBlocklist.add') }}</span>
        </button>
      </div>

      <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{{ visibleCountLabel }}</p>
        <div class="relative sm:w-64">
          <Search class="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            v-model="filterText"
            class="w-full h-8 rounded-md border border-input bg-background pl-8 pr-3 text-sm outline-none transition-shadow focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
            :placeholder="t('settings.metadata.genreBlocklist.filterPlaceholder')"
          />
        </div>
      </div>

      <div v-if="draftBlocklist.length" class="rounded-lg border border-border overflow-hidden">
        <div v-if="filteredBlocklist.length" class="divide-y divide-border">
          <div v-for="genre in filteredBlocklist" :key="genre" class="flex items-center justify-between gap-3 px-3 py-2.5 bg-background">
            <span class="min-w-0 truncate text-sm font-medium text-foreground">{{ genre }}</span>
            <button
              class="settings-btn h-7 w-7 shrink-0 inline-flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-destructive hover:border-destructive/50 hover:bg-destructive/5 transition-colors"
              type="button"
              :aria-label="removeGenreLabel(genre)"
              :disabled="isBusy"
              @click="removeGenre(genre)"
            >
              <Trash2 :size="13" />
            </button>
          </div>
        </div>
        <div v-else class="px-4 py-8 text-center text-sm text-muted-foreground">{{ t('settings.metadata.genreBlocklist.noFilterMatch') }}</div>
      </div>

      <div v-else class="rounded-lg border border-dashed border-border px-4 py-10 text-center">
        <p class="text-sm font-medium text-foreground">{{ t('settings.metadata.genreBlocklist.emptyTitle') }}</p>
        <p class="mt-1 text-xs text-muted-foreground">{{ t('settings.metadata.genreBlocklist.emptyHint') }}</p>
      </div>
    </div>
  </div>
</template>
