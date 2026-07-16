<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { ChevronDown, ExternalLink, Search, Sparkles } from '@lucide/vue'
import type { ReleaseNote, ReleaseNotesResponse } from '@bookorbit/types'
import { api } from '@/lib/api'
import { useWhatsNew } from './composables/useWhatsNew'
import { formatReleaseDate } from './lib/whats-new.logic'
import { renderChangelogMarkdown } from './lib/markdown'
import HighlightItem from './components/HighlightItem.vue'

const { t } = useI18n()
const { version, markArchiveSeen } = useWhatsNew()

const releases = ref<ReleaseNote[]>([])
const page = ref(1)
const hasMore = ref(false)
const loading = ref(false)
const loadingMore = ref(false)
const error = ref<string | null>(null)
const search = ref('')
const expandedChangelogs = ref(new Set<string>())
const activeVersion = ref<string | null>(null)

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return releases.value
  return releases.value.filter((release) => {
    if (release.version.toLowerCase().includes(q)) return true
    if (release.name?.toLowerCase().includes(q)) return true
    return release.highlights.some((h) => h.title.toLowerCase().includes(q) || h.body.toLowerCase().includes(q))
  })
})

async function loadPage(target: number): Promise<void> {
  const res = await api(`/api/v1/release-notes?page=${target}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as ReleaseNotesResponse
  releases.value = target === 1 ? data.releases : [...releases.value, ...data.releases]
  hasMore.value = data.hasMore
  page.value = target
}

async function loadFirst(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    await loadPage(1)
  } catch (e) {
    error.value = e instanceof Error ? e.message : t('whatsNew.loadFailed')
  } finally {
    loading.value = false
  }
}

async function loadMore(): Promise<void> {
  loadingMore.value = true
  try {
    await loadPage(page.value + 1)
  } catch {
    // Keep the releases already loaded; surface the failure so the button isn't a no-op.
    toast.error(t('whatsNew.loadMoreFailed'))
  } finally {
    loadingMore.value = false
  }
}

function retry(): void {
  void loadFirst()
}

function toggleChangelog(release: ReleaseNote): void {
  const next = new Set(expandedChangelogs.value)
  if (next.has(release.version)) next.delete(release.version)
  else next.add(release.version)
  expandedChangelogs.value = next
}

function isChangelogOpen(release: ReleaseNote): boolean {
  return expandedChangelogs.value.has(release.version)
}

function isCurrent(release: ReleaseNote): boolean {
  return !!version.value && release.version === version.value
}

function anchorId(versionTag: string): string {
  return 'release-' + versionTag.replace(/[^a-zA-Z0-9]+/g, '-')
}

// Scrollspy: highlight the rail entry whose card the user has scrolled to.
let scrollEl: EventTarget | null = null

function updateActiveVersion(): void {
  const first = filtered.value[0]
  if (!first) return
  const offset = 120
  let current = first.version
  for (const release of filtered.value) {
    const el = document.getElementById(anchorId(release.version))
    if (!el) continue
    if (el.getBoundingClientRect().top - offset <= 0) current = release.version
    else break
  }
  activeVersion.value = current
}

watch(
  () => filtered.value.map((r) => r.version).join(','),
  () => nextTick(updateActiveVersion),
)

onMounted(() => {
  void loadFirst().then(() => nextTick(updateActiveVersion))
  void markArchiveSeen()
  scrollEl = document.querySelector<HTMLElement>('.app-shell-scroll') ?? window
  scrollEl.addEventListener('scroll', updateActiveVersion, { passive: true })
  window.addEventListener('resize', updateActiveVersion)
})

onUnmounted(() => {
  scrollEl?.removeEventListener('scroll', updateActiveVersion)
  window.removeEventListener('resize', updateActiveVersion)
})
</script>

<template>
  <div class="w-full max-w-6xl px-4 py-6">
    <header class="mb-5 flex items-center gap-3">
      <span class="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Sparkles :size="20" />
      </span>
      <div>
        <h1 class="text-xl font-semibold tracking-tight text-foreground">{{ t('whatsNew.title') }}</h1>
        <p class="text-sm text-muted-foreground">{{ t('whatsNew.subtitle') }}</p>
      </div>
    </header>

    <div class="lg:flex lg:gap-6">
      <nav v-if="!loading && !error && filtered.length" class="hidden w-48 shrink-0 lg:order-last lg:block">
        <div class="sticky top-2 space-y-1">
          <p class="px-2 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{{ t('whatsNew.versions') }}</p>
          <a
            v-for="release in filtered"
            :key="release.version"
            :href="'#' + anchorId(release.version)"
            :aria-current="activeVersion === release.version ? 'location' : undefined"
            class="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors"
            :class="
              activeVersion === release.version
                ? 'bg-muted font-semibold text-foreground'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
            "
          >
            <span class="truncate">{{ release.version }}</span>
            <span v-if="isCurrent(release)" class="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" :aria-label="t('whatsNew.currentVersion')" />
          </a>
        </div>
      </nav>

      <div class="min-w-0 flex-1">
        <div class="relative mb-5">
          <Search :size="16" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            v-model="search"
            type="search"
            :placeholder="t('whatsNew.searchPlaceholder')"
            class="w-full rounded-md border border-input bg-background py-2 pl-9 pr-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        <div v-if="loading" class="space-y-3">
          <div v-for="n in 4" :key="n" class="h-28 animate-pulse rounded-lg border border-border bg-card" />
        </div>

        <div v-else-if="error" class="rounded-lg border border-border bg-card p-6 text-center">
          <p class="text-sm text-muted-foreground">{{ t('whatsNew.loadErrorHint') }}</p>
          <button
            type="button"
            class="mt-3 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
            @click="retry"
          >
            {{ t('whatsNew.retry') }}
          </button>
        </div>

        <div v-else-if="filtered.length === 0" class="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          {{ t('whatsNew.noReleasesFound') }}
        </div>

        <div v-else class="space-y-4">
          <article
            v-for="release in filtered"
            :id="anchorId(release.version)"
            :key="release.version"
            class="scroll-mt-4 rounded-lg border border-border bg-card p-4 shadow-xs md:p-5"
          >
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="text-base font-semibold text-foreground">{{ release.version }}</h2>
              <span v-if="isCurrent(release)" class="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{{
                t('whatsNew.youreHere')
              }}</span>
              <span v-if="formatReleaseDate(release.date)" class="text-xs text-muted-foreground">{{ formatReleaseDate(release.date) }}</span>
            </div>

            <template v-if="release.highlights.length">
              <ul class="mt-3 divide-y divide-border/60">
                <li v-for="(highlight, hIndex) in release.highlights" :key="hIndex" class="py-4 first:pt-0 last:pb-0">
                  <HighlightItem :highlight="highlight" />
                </li>
              </ul>
            </template>

            <p v-else class="mt-3 text-sm text-muted-foreground">{{ t('whatsNew.noHighlights') }}</p>

            <div class="mt-4 flex flex-wrap items-center gap-4">
              <button
                v-if="release.changelogBody"
                type="button"
                class="inline-flex items-center gap-1 text-xs font-medium text-foreground transition-colors hover:text-primary"
                @click="toggleChangelog(release)"
              >
                <ChevronDown
                  :size="14"
                  class="transition-transform motion-reduce:transition-none"
                  :class="isChangelogOpen(release) ? 'rotate-180' : ''"
                />
                {{ isChangelogOpen(release) ? t('whatsNew.hideChangelog') : t('whatsNew.showChangelog') }}
              </button>
              <a
                :href="release.changelogUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:text-primary/85"
              >
                {{ t('whatsNew.openOnGitHub') }}
                <ExternalLink :size="12" />
              </a>
            </div>

            <!-- eslint-disable-next-line vue/no-v-html -- sanitized by renderChangelogMarkdown (DOMPurify) -->
            <div
              v-if="isChangelogOpen(release) && release.changelogBody"
              class="whats-new-changelog mt-3 border-t border-border/60 pt-3 text-sm text-muted-foreground"
              v-html="renderChangelogMarkdown(release.changelogBody)"
            />
          </article>

          <div v-if="hasMore && !search.trim()" class="pt-1 text-center">
            <button
              type="button"
              :disabled="loadingMore"
              class="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
              @click="loadMore"
            >
              {{ loadingMore ? t('whatsNew.loadingMore') : t('whatsNew.loadMore') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.whats-new-changelog :deep(h1),
.whats-new-changelog :deep(h2),
.whats-new-changelog :deep(h3) {
  font-weight: 600;
  color: var(--foreground);
  margin: 0.75rem 0 0.25rem;
  font-size: 0.875rem;
}
.whats-new-changelog :deep(ul) {
  list-style: disc;
  padding-left: 1.25rem;
  margin: 0.25rem 0;
}
.whats-new-changelog :deep(a) {
  color: var(--primary);
}
.whats-new-changelog :deep(code) {
  font-family: ui-monospace, monospace;
  font-size: 0.8em;
}
</style>
