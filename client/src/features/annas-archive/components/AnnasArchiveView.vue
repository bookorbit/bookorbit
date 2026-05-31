<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { BookDown, Download, Loader2, Search, ExternalLink, AlertCircle, CheckCircle2 } from 'lucide-vue-next'
import type { Library, LibraryFolder } from '@bookorbit/types'

import { useLibraries } from '@/features/library/composables/useLibraries'
import {
  searchAnnasArchive,
  startDownload,
  listDownloadJobs,
  getActiveDomains,
  refreshDomains,
  type AnnasArchiveSearchResult,
  type AnnasArchiveDownloadJob,
} from '../api'

const { libraries, fetchLibraries } = useLibraries()

const query = ref('')
const extFilter = ref('')
const langFilter = ref('')

const results = ref<AnnasArchiveSearchResult[]>([])
const jobs = ref<AnnasArchiveDownloadJob[]>([])
const activeDomains = ref<string[]>([])
const refreshingDomains = ref(false)

const searching = ref(false)
const searchError = ref<string | null>(null)

const selectedLibraryId = ref<number | null>(null)
const selectedFolderId = ref<number | null>(null)

const selectedLibrary = computed<Library | undefined>(() => libraries.value.find((l) => l.id === selectedLibraryId.value))

const folders = computed<LibraryFolder[]>(() => selectedLibrary.value?.folders ?? [])

onMounted(async () => {
  await fetchLibraries()
  if (libraries.value.length > 0) {
    selectedLibraryId.value = libraries.value[0]!.id
  }
  await Promise.all([refreshJobs(), loadDomains()])
})

async function loadDomains() {
  try {
    activeDomains.value = await getActiveDomains()
  } catch {
    // ignore
  }
}

async function handleRefreshDomains() {
  refreshingDomains.value = true
  try {
    await refreshDomains()
    await loadDomains()
  } catch {
    // ignore
  } finally {
    refreshingDomains.value = false
  }
}

async function search() {
  if (!query.value.trim()) return
  searching.value = true
  searchError.value = null
  results.value = []
  try {
    results.value = await searchAnnasArchive(query.value.trim(), extFilter.value || undefined, langFilter.value || undefined)
    if (results.value.length === 0) searchError.value = 'Geen resultaten gevonden.'
  } catch (e) {
    searchError.value = e instanceof Error ? e.message : 'Zoekopdracht mislukt.'
  } finally {
    searching.value = false
  }
}

async function download(result: AnnasArchiveSearchResult) {
  if (!selectedLibraryId.value) return
  const ext = result.format ?? 'epub'
  const safeTitle = result.title.replace(/[/\\?%*:|"<>]/g, '-').slice(0, 120)
  const filename = `${safeTitle}.${ext}`

  try {
    const job = await startDownload({
      md5: result.md5,
      libraryId: selectedLibraryId.value,
      folderId: selectedFolderId.value ?? undefined,
      filename,
    })
    jobs.value.unshift(job)
  } catch (e) {
    alert(`Download starten mislukt: ${e instanceof Error ? e.message : e}`)
  }
}

async function refreshJobs() {
  try {
    jobs.value = await listDownloadJobs()
  } catch {
    // ignore
  }
}

function statusLabel(status: AnnasArchiveDownloadJob['status']): string {
  const labels: Record<string, string> = {
    pending: 'Wachten…',
    fetching_links: 'Links ophalen…',
    downloading: 'Downloaden…',
    completed: 'Klaar',
    failed: 'Mislukt',
  }
  return labels[status] ?? status
}

function progress(job: AnnasArchiveDownloadJob): number {
  if (!job.totalBytes || !job.downloadedBytes) return 0
  return Math.round((job.downloadedBytes / job.totalBytes) * 100)
}
</script>

<template>
  <div class="flex flex-col gap-6 max-w-4xl mx-auto">
    <!-- Header -->
    <div class="flex items-center gap-3">
      <BookDown class="size-6 text-primary shrink-0" />
      <div>
        <h1 class="text-lg font-semibold">Anna's Archive</h1>
        <p class="text-sm text-muted-foreground">Zoek en download boeken via Anna's Archive</p>
      </div>
    </div>

    <!-- Active domains status -->
    <div class="flex items-center gap-2 flex-wrap">
      <span class="text-xs text-muted-foreground">Actieve mirrors:</span>
      <span
        v-for="domain in activeDomains"
        :key="domain"
        class="text-xs bg-green-500/10 text-green-700 dark:text-green-400 px-2 py-0.5 rounded font-mono"
        >{{ domain.replace('https://', '') }}</span
      >
      <span v-if="activeDomains.length === 0" class="text-xs text-muted-foreground italic">laden…</span>
      <button
        class="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
        :disabled="refreshingDomains"
        @click="handleRefreshDomains"
      >
        <Loader2 v-if="refreshingDomains" class="size-3 animate-spin" />
        <span>Mirrors vernieuwen</span>
      </button>
    </div>

    <!-- Library selector -->
    <div class="flex flex-wrap gap-3">
      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium text-muted-foreground">Bibliotheek</label>
        <select
          v-model="selectedLibraryId"
          class="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          @change="selectedFolderId = null"
        >
          <option v-for="lib in libraries" :key="lib.id" :value="lib.id">{{ lib.name }}</option>
        </select>
      </div>

      <div v-if="folders.length > 1" class="flex flex-col gap-1">
        <label class="text-xs font-medium text-muted-foreground">Map (optioneel)</label>
        <select
          v-model="selectedFolderId"
          class="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option :value="null">Eerste map</option>
          <option v-for="folder in folders" :key="folder.id" :value="folder.id">
            {{ folder.path }}
          </option>
        </select>
      </div>
    </div>

    <!-- Search bar -->
    <div class="flex flex-col gap-2">
      <div class="flex gap-2">
        <div class="relative flex-1">
          <Search class="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            v-model="query"
            type="text"
            placeholder="Zoek op titel, auteur of ISBN…"
            class="w-full h-9 pl-9 pr-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            @keydown.enter="search"
          />
        </div>
        <button
          class="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
          :disabled="searching || !query.trim()"
          @click="search"
        >
          <Loader2 v-if="searching" class="size-4 animate-spin" />
          <span>Zoeken</span>
        </button>
      </div>

      <!-- Filters -->
      <div class="flex gap-3 flex-wrap">
        <div class="flex items-center gap-2">
          <label class="text-xs text-muted-foreground">Formaat:</label>
          <select v-model="extFilter" class="h-7 rounded border border-input bg-background px-2 text-xs focus:outline-none">
            <option value="">Alle</option>
            <option value="epub">EPUB</option>
            <option value="pdf">PDF</option>
            <option value="mobi">MOBI</option>
            <option value="cbz">CBZ</option>
          </select>
        </div>
        <div class="flex items-center gap-2">
          <label class="text-xs text-muted-foreground">Taal:</label>
          <select v-model="langFilter" class="h-7 rounded border border-input bg-background px-2 text-xs focus:outline-none">
            <option value="">Alle</option>
            <option value="nl">Nederlands</option>
            <option value="en">Engels</option>
            <option value="de">Duits</option>
            <option value="fr">Frans</option>
          </select>
        </div>
      </div>
    </div>

    <!-- Error -->
    <div v-if="searchError" class="flex items-center gap-2 text-sm text-destructive">
      <AlertCircle class="size-4 shrink-0" />
      {{ searchError }}
    </div>

    <!-- Search results -->
    <div v-if="results.length > 0" class="flex flex-col gap-2">
      <p class="text-xs text-muted-foreground">{{ results.length }} resultaten</p>
      <div class="flex flex-col gap-2">
        <div v-for="result in results" :key="result.md5" class="flex items-start gap-3 rounded-lg border border-border/60 bg-card p-3">
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium truncate">{{ result.title }}</p>
            <p v-if="result.author" class="text-xs text-muted-foreground truncate">{{ result.author }}</p>
            <div class="flex gap-2 mt-1 flex-wrap">
              <span v-if="result.format" class="text-xs uppercase font-mono bg-muted px-1.5 py-0.5 rounded">
                {{ result.format }}
              </span>
              <span v-if="result.filesize" class="text-xs text-muted-foreground">{{ result.filesize }}</span>
              <span v-if="result.language" class="text-xs text-muted-foreground uppercase">{{ result.language }}</span>
            </div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <a
              :href="result.url"
              target="_blank"
              rel="noopener noreferrer"
              class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ExternalLink class="size-3.5" />
            </a>
            <button
              class="flex items-center gap-1 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50"
              :disabled="!selectedLibraryId"
              @click="download(result)"
            >
              <Download class="size-3.5" />
              Download
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Downloads -->
    <div v-if="jobs.length > 0" class="flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-medium">Downloads</h2>
        <button class="text-xs text-muted-foreground hover:text-foreground" @click="refreshJobs">Vernieuwen</button>
      </div>
      <div class="flex flex-col gap-2">
        <div v-for="job in jobs" :key="job.id" class="rounded-lg border border-border/60 bg-card p-3">
          <div class="flex items-start gap-2">
            <CheckCircle2 v-if="job.status === 'completed'" class="size-4 text-green-500 mt-0.5 shrink-0" />
            <AlertCircle v-else-if="job.status === 'failed'" class="size-4 text-destructive mt-0.5 shrink-0" />
            <Loader2 v-else class="size-4 animate-spin text-primary mt-0.5 shrink-0" />
            <div class="flex-1 min-w-0">
              <p class="text-sm truncate">{{ job.filename }}</p>
              <p class="text-xs text-muted-foreground">{{ statusLabel(job.status) }}</p>
              <p v-if="job.status === 'failed' && job.error" class="text-xs text-destructive mt-0.5">{{ job.error }}</p>
            </div>
          </div>
          <!-- Progress bar -->
          <div v-if="job.status === 'downloading' && job.totalBytes" class="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
            <div class="h-full bg-primary transition-all" :style="{ width: `${progress(job)}%` }" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
