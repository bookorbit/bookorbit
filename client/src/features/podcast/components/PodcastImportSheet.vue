<script setup lang="ts">
import { computed, toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { FolderSearch, HardDrive, Plus } from '@lucide/vue'
import type { PodcastImportAmbiguousFile, PodcastImportSuggestedFeed, PodcastImportUnclaimedFolder } from '@bookorbit/types'
import { formatBytes } from '@/lib/formatting'
import { formatNumber } from '@/i18n/formatters'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import FormSheet from '@/components/FormSheet.vue'
import PodcastImportGroup from './PodcastImportGroup.vue'
import { usePodcastImport } from '../composables/usePodcastImport'

const props = defineProps<{ open: boolean; libraryId: number }>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  subscribed: []
  applied: []
}>()

const { t } = useI18n()
const importer = usePodcastImport(toRef(props, 'libraryId'))
const { report, running, starting, subscribingFeedUrl, subscribedFeedUrls, creatingFolderPath, createdFolderPaths } = importer

const busy = computed(() => starting.value || running.value)
const quotaAdoptBytes = computed(() => Number(report.value?.quota.adoptBytes ?? 0))
const quotaHeadroomBytes = computed(() => Number(report.value?.quota.headroomBytes ?? 0))
const blocked = computed(() => report.value?.blockedReason === 'quota_exceeded')
const scanFailed = computed(() => importer.job.value?.status === 'failed')
const applyLabel = computed(() => (importer.resolutions.value.size > 0 ? t('podcast.import.applyWithChoices') : t('podcast.import.apply')))
const progressLabel = computed(() =>
  t('podcast.import.progress', {
    current: formatNumber(importer.job.value?.progressCurrent ?? 0),
    total: formatNumber(importer.job.value?.progressTotal ?? 0),
  }),
)

const summary = computed(() => {
  const counts = report.value?.counts
  if (!counts) return []
  return [
    { id: 'matched' as const, label: t('podcast.import.groups.matched'), value: counts.matched },
    { id: 'ambiguous' as const, label: t('podcast.import.groups.ambiguous'), value: counts.ambiguous },
    { id: 'unmatched' as const, label: t('podcast.import.groups.unmatched'), value: counts.unmatched },
    { id: 'duplicates' as const, label: t('podcast.import.groups.duplicates'), value: counts.duplicates },
    { id: 'skipped' as const, label: t('podcast.import.groups.skipped'), value: counts.skipped },
  ]
})

function handleOpenChange(open: boolean) {
  emit('update:open', open)
}

function handleOpened() {
  void importer.refresh()
}

function handleClosed() {
  importer.stopPolling()
}

async function startDryRun() {
  importer.clearResolutions()
  const started = await importer.start({ dryRun: true })
  if (!started && importer.error.value) toast.error(importer.error.value)
}

async function applyImport() {
  const started = await importer.start({ dryRun: false })
  if (!started) {
    if (importer.error.value) toast.error(importer.error.value)
    return
  }
  emit('applied')
}

function resolutionFor(file: PodcastImportAmbiguousFile): string {
  const episodeId = importer.resolutions.value.get(file.path)
  return episodeId === undefined ? '' : String(episodeId)
}

function handleResolutionChange(file: PodcastImportAmbiguousFile, value: string | number) {
  importer.resolveFile(file.path, value === '' ? null : Number(value))
}

function candidateLabel(candidate: { episodeTitle: string; publishedAt: string | null; signals: string[] }): string {
  const signals = candidate.signals.map((signal) => t(`podcast.import.signals.${signal}`)).join(', ')
  const published = candidate.publishedAt ? candidate.publishedAt.slice(0, 10) : t('podcast.import.noDate')
  return `${candidate.episodeTitle} · ${published} · ${signals}`
}

function signalsLabel(signals: string[]): string {
  return signals.map((signal) => t(`podcast.import.signals.${signal}`)).join(', ')
}

function reasonLabel(reason: string): string {
  return t(`podcast.import.reasons.${reason}`)
}

function scopeLabel(scope: string): string {
  return t(`podcast.import.scopes.${scope}`)
}

function sourceLabel(source: string): string {
  return t(`podcast.import.sources.${source}`)
}

function localShowLabel(folder: PodcastImportUnclaimedFolder): string {
  if (createdFolderPaths.value.has(folder.folderPath)) return t('podcast.import.localShowCreated')
  return folder.existingPodcastId === null ? t('podcast.import.createLocalShow') : t('podcast.import.addLocalEpisodes')
}

async function subscribeToFeed(feed: PodcastImportSuggestedFeed) {
  if (await importer.subscribeToFeed(feed.feedUrl)) emit('subscribed')
}

async function createLocalShow(folder: PodcastImportUnclaimedFolder) {
  if (await importer.createLocalShow(folder.folderPath)) emit('subscribed')
}
</script>

<template>
  <FormSheet
    :open="open"
    :title="t('podcast.import.title')"
    :description="t('podcast.import.description')"
    content-class="sm:max-w-2xl"
    :busy="starting"
    :submit-label="applyLabel"
    :submit-disabled="!importer.canApply.value || busy"
    submit-test-id="podcast-import-apply"
    data-testid="podcast-local-import-sheet"
    :aria-busy="busy"
    @update:open="handleOpenChange"
    @opened="handleOpened"
    @closed="handleClosed"
    @submit="applyImport"
  >
    <div class="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-4">
      <p class="rounded-lg bg-muted/60 px-3 py-2 text-xs leading-5 text-muted-foreground">{{ t('podcast.import.placementHint') }}</p>

      <div class="flex flex-wrap items-center gap-2">
        <Button variant="outline" :disabled="busy" :aria-busy="busy" data-testid="podcast-import-scan" @click="startDryRun">
          <FolderSearch :size="14" /> {{ t('podcast.import.scan') }}
        </Button>
        <span v-if="running" class="text-xs text-muted-foreground">{{ t('podcast.import.running') }}</span>
      </div>

      <div v-if="running" role="status" aria-live="polite" class="space-y-1.5">
        <p class="text-xs text-muted-foreground">{{ progressLabel }}</p>
        <div class="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div class="h-full rounded-full bg-primary transition-[width]" :style="{ width: `${importer.progressPercent.value}%` }" />
        </div>
      </div>

      <p v-if="importer.error.value" class="text-sm text-destructive" role="alert">{{ importer.error.value }}</p>
      <p v-else-if="scanFailed && importer.job.value?.lastError" class="text-sm text-destructive" role="alert">
        {{ importer.job.value.lastError }}
      </p>

      <template v-if="report">
        <div class="rounded-lg border border-border">
          <dl class="grid grid-cols-2 gap-x-4 gap-y-2 p-3 text-xs sm:grid-cols-5">
            <div v-for="entry in summary" :key="entry.id" class="min-w-0">
              <dt class="truncate text-muted-foreground">{{ entry.label }}</dt>
              <dd class="text-sm font-medium">{{ formatNumber(entry.value) }}</dd>
            </div>
          </dl>
          <p class="border-t border-border px-3 py-2 text-xs text-muted-foreground">
            {{ t('podcast.import.quota', { adopt: formatBytes(quotaAdoptBytes), headroom: formatBytes(quotaHeadroomBytes) }) }}
          </p>
          <p v-if="report.truncated" class="border-t border-border px-3 py-2 text-xs text-muted-foreground">
            {{ t('podcast.import.truncated') }}
          </p>
        </div>

        <p v-if="blocked" class="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          {{ t('podcast.import.reasons.quota_exceeded') }}
        </p>
        <p v-else-if="!report.dryRun" class="rounded-lg border border-border px-3 py-2 text-sm">
          {{ t('podcast.import.applied', { count: formatNumber(report.attached) }) }}
        </p>

        <section v-if="report.suggestedFeeds.length > 0" class="space-y-2">
          <h3 class="text-sm font-medium">{{ t('podcast.import.groups.suggestedFeeds') }}</h3>
          <p class="text-xs text-muted-foreground">{{ t('podcast.import.suggestedFeedsHint') }}</p>
          <ul class="space-y-2">
            <li
              v-for="feed in report.suggestedFeeds"
              :key="feed.folderPath"
              class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
            >
              <div class="min-w-0">
                <p class="truncate text-sm font-medium">{{ feed.folderPath }}</p>
                <p class="truncate text-xs text-muted-foreground">
                  {{ feed.feedUrl }} · {{ sourceLabel(feed.source) }} · {{ t('podcast.import.fileCount', { count: feed.fileCount }) }}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                :disabled="subscribingFeedUrl !== null || subscribedFeedUrls.has(feed.feedUrl)"
                @click="subscribeToFeed(feed)"
              >
                <Plus :size="13" /> {{ subscribedFeedUrls.has(feed.feedUrl) ? t('podcast.import.subscribed') : t('podcast.import.subscribe') }}
              </Button>
            </li>
          </ul>
          <p v-if="subscribedFeedUrls.size > 0" class="text-xs text-muted-foreground">{{ t('podcast.import.rescanHint') }}</p>
        </section>

        <section v-if="report.unclaimedFolders.length > 0" class="space-y-2">
          <h3 class="text-sm font-medium">{{ t('podcast.import.groups.unclaimedFolders') }}</h3>
          <p class="text-xs text-muted-foreground">{{ t('podcast.import.unclaimedFoldersHint') }}</p>
          <ul class="space-y-2">
            <li
              v-for="folder in report.unclaimedFolders"
              :key="folder.folderPath"
              class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
            >
              <div class="min-w-0">
                <p class="truncate text-sm font-medium">{{ folder.suggestedTitle }}</p>
                <p class="truncate text-xs text-muted-foreground">
                  {{ folder.folderPath }}
                  <template v-if="folder.suggestedAuthor"> · {{ folder.suggestedAuthor }}</template>
                  · {{ t('podcast.import.fileCount', { count: folder.fileCount }) }}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                :disabled="creatingFolderPath !== null || createdFolderPaths.has(folder.folderPath)"
                :data-testid="`podcast-create-local-show-${folder.folderPath}`"
                @click="createLocalShow(folder)"
              >
                <HardDrive :size="13" /> {{ localShowLabel(folder) }}
              </Button>
            </li>
          </ul>
          <p v-if="createdFolderPaths.size > 0" class="text-xs text-muted-foreground">{{ t('podcast.import.localRescanHint') }}</p>
        </section>

        <PodcastImportGroup
          v-if="report.ambiguous.length > 0"
          id="ambiguous"
          :label="t('podcast.import.groups.ambiguous')"
          :count="report.counts.ambiguous"
          default-expanded
        >
          <li v-for="file in report.ambiguous" :key="file.path" class="rounded-lg border border-border px-3 py-2">
            <p class="truncate text-sm font-medium">{{ file.fileName }}</p>
            <p class="truncate text-xs text-muted-foreground">{{ file.path }} · {{ scopeLabel(file.scope) }} · {{ reasonLabel(file.reason) }}</p>
            <label class="mt-2 block text-xs font-medium" :for="`podcast-import-pick-${file.path}`">
              {{ t('podcast.import.chooseEpisode') }}
            </label>
            <Select
              :id="`podcast-import-pick-${file.path}`"
              :model-value="resolutionFor(file)"
              class="mt-1"
              @update:model-value="handleResolutionChange(file, $event)"
            >
              <option value="">{{ t('podcast.import.leaveUnresolved') }}</option>
              <option v-for="candidate in file.candidates" :key="candidate.episodeId" :value="candidate.episodeId">
                {{ candidateLabel(candidate) }}
              </option>
            </Select>
          </li>
        </PodcastImportGroup>

        <PodcastImportGroup v-if="report.matched.length > 0" id="matched" :label="t('podcast.import.groups.matched')" :count="report.counts.matched">
          <li v-for="file in report.matched" :key="file.path" class="rounded-lg border border-border px-3 py-2">
            <p class="truncate text-sm font-medium">{{ file.episodeTitle }}</p>
            <p class="truncate text-xs text-muted-foreground">{{ file.podcastTitle }} · {{ file.fileName }} · {{ signalsLabel(file.signals) }}</p>
          </li>
        </PodcastImportGroup>

        <PodcastImportGroup
          v-if="report.duplicates.length > 0"
          id="duplicates"
          :label="t('podcast.import.groups.duplicates')"
          :count="report.counts.duplicates"
        >
          <li v-for="file in report.duplicates" :key="file.path" class="rounded-lg border border-border px-3 py-2">
            <p class="truncate text-sm font-medium">{{ file.fileName }}</p>
            <p class="truncate text-xs text-muted-foreground">
              {{ file.episodeTitle }} ·
              {{ file.contentDiffers ? t('podcast.import.duplicateDiffers') : t('podcast.import.duplicateSame') }}
            </p>
          </li>
        </PodcastImportGroup>

        <PodcastImportGroup
          v-if="report.unmatched.length > 0"
          id="unmatched"
          :label="t('podcast.import.groups.unmatched')"
          :count="report.counts.unmatched"
          default-expanded
        >
          <li v-for="file in report.unmatched" :key="file.path" class="rounded-lg border border-border px-3 py-2">
            <p class="truncate text-sm font-medium">{{ file.fileName }}</p>
            <p class="truncate text-xs text-muted-foreground">
              {{ reasonLabel(file.reason) }}<template v-if="file.podcastTitle"> · {{ file.podcastTitle }}</template>
            </p>
          </li>
        </PodcastImportGroup>

        <PodcastImportGroup
          v-if="report.skipped.length > 0"
          id="skipped"
          :label="t('podcast.import.groups.skipped')"
          :count="report.counts.skipped"
          list-class="space-y-1"
        >
          <li v-for="file in report.skipped" :key="file.path" class="truncate text-xs text-muted-foreground">
            {{ file.path }} · {{ reasonLabel(file.reason) }}
          </li>
        </PodcastImportGroup>

        <p v-if="report.unreadableFolders.length > 0" class="text-xs text-muted-foreground">
          {{ t('podcast.import.unreadableFolders', { count: report.unreadableFolders.length }) }}
        </p>
      </template>
    </div>
  </FormSheet>
</template>
