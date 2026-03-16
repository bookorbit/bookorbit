<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Sparkles, Users } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { useBookMetadataFetchStatus } from '../composables/useBookMetadataFetchStatus'
import { useAuthorEnrichmentStatus } from '@/features/settings/composables/useAuthorEnrichmentStatus'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import BookMetadataFetchExpanded from './BookMetadataFetchExpanded.vue'
import BookMetadataFetchReportModal from './BookMetadataFetchReportModal.vue'
import AuthorEnrichmentExpanded from './AuthorEnrichmentExpanded.vue'
import AuthorEnrichmentReportModal from './AuthorEnrichmentReportModal.vue'

const { status, subscribe } = useBookMetadataFetchStatus()
const { status: authorStatus, subscribe: subscribeAuthors } = useAuthorEnrichmentStatus()
const { hasPermission, isSuperuser } = usePermissions()

const canView = computed(() => isSuperuser.value || hasPermission('manage_metadata_config'))

// Sticky last-known name: keep showing the previous name during the gap between items.
// Reset only when the session fully ends (sessionTotal goes back to 0).
const lastBookName = ref<string | null>(null)
const lastAuthorName = ref<string | null>(null)

watch(
  () => status.value.currentItemName,
  (name) => {
    if (name) lastBookName.value = name
  },
)
watch(
  () => status.value.sessionTotal,
  (total) => {
    if (total === 0) lastBookName.value = null
  },
)
watch(
  () => authorStatus.value.currentItemName,
  (name) => {
    if (name) lastAuthorName.value = name.trim()
  },
)

const isBookFetchActive = computed(() => status.value.queued + status.value.processing + status.value.failed > 0)
const isAuthorActive = computed(
  () => authorStatus.value.queued + authorStatus.value.processing + authorStatus.value.rateLimited + authorStatus.value.failed > 0,
)

watch(isAuthorActive, (active) => {
  if (!active) lastAuthorName.value = null
})
const isAnyActive = computed(() => isBookFetchActive.value || isAuthorActive.value)

const bookProgressPercent = computed(() => {
  if (status.value.sessionTotal === 0) return 0
  return Math.round((status.value.sessionDone / status.value.sessionTotal) * 100)
})
const authorProgressPercent = computed(() => {
  if (authorStatus.value.sessionTotal === 0) return 0
  return Math.round((authorStatus.value.sessionDone / authorStatus.value.sessionTotal) * 100)
})

const bookRemainingLabel = computed(() => {
  if (status.value.paused) return 'Paused'
  const { queued, processing, failed } = status.value
  if (queued > 0) return `${queued + processing} remaining`
  if (processing > 0) return `${processing} processing`
  if (failed > 0) return `${failed} failed`
  return ''
})
const authorRemainingLabel = computed(() => {
  if (authorStatus.value.paused) return 'Paused'
  const { queued, processing, rateLimited, failed } = authorStatus.value
  if (rateLimited > 0) return `${rateLimited} rate limited`
  if (queued > 0) return `${queued + processing} remaining`
  if (processing > 0) return `${processing} processing`
  if (failed > 0) return `${failed} failed`
  return ''
})

const bookIconWrapperClass = computed(() => {
  if (status.value.failed > 0 && status.value.processing === 0 && status.value.queued === 0) return 'bg-amber-500/15'
  return 'bg-violet-500/10'
})
const bookIconOpacity = computed(() => (status.value.paused ? 'opacity-40' : ''))

const showBookDot = computed(() => !status.value.paused && (status.value.processing > 0 || status.value.failed > 0))

const authorIconWrapperClass = computed(() => {
  if ((authorStatus.value.rateLimited > 0 || authorStatus.value.failed > 0) && authorStatus.value.processing === 0 && authorStatus.value.queued === 0)
    return 'bg-amber-500/15'
  return 'bg-emerald-500/10'
})
const authorIconOpacity = computed(() => (authorStatus.value.paused ? 'opacity-40' : ''))

const showAuthorDot = computed(
  () => !authorStatus.value.paused && (authorStatus.value.processing > 0 || authorStatus.value.rateLimited > 0 || authorStatus.value.failed > 0),
)

// completion toast - fires only when transitioning from active to done, not on the initial snapshot
let bookSessionToasted = false
watch(status, (newVal, oldVal) => {
  const wasActive = oldVal.queued > 0 || oldVal.processing > 0
  const isDone = newVal.sessionTotal > 0 && newVal.sessionDone >= newVal.sessionTotal && newVal.queued === 0 && newVal.processing === 0
  if (!bookSessionToasted && wasActive && isDone) {
    bookSessionToasted = true
    const msg =
      newVal.failed > 0
        ? `Metadata fetch done - ${newVal.sessionDone} processed, ${newVal.failed} failed`
        : `Metadata fetch complete - ${newVal.sessionDone} books updated`
    toast.success(msg)
  }
  if (newVal.sessionTotal === 0) bookSessionToasted = false
})

let authorSessionToasted = false
watch(authorStatus, (newVal, oldVal) => {
  const wasActive = oldVal.queued > 0 || oldVal.processing > 0 || oldVal.rateLimited > 0
  const isDone =
    newVal.sessionTotal > 0 && newVal.sessionDone >= newVal.sessionTotal && newVal.queued === 0 && newVal.processing === 0 && newVal.rateLimited === 0
  if (!authorSessionToasted && wasActive && isDone) {
    authorSessionToasted = true
    const msg =
      newVal.failed > 0
        ? `Author enrichment done - ${newVal.sessionDone} processed, ${newVal.failed} failed`
        : `Author enrichment complete - ${newVal.sessionDone} authors updated`
    toast.success(msg)
  }
  if (newVal.sessionTotal === 0) authorSessionToasted = false
})

const expanded = ref(false)
const showReport = ref(false)
const authorExpanded = ref(false)
const showAuthorReport = ref(false)

function toggleExpanded() {
  expanded.value = !expanded.value
  if (expanded.value) authorExpanded.value = false
}

function handleClose() {
  expanded.value = false
}

function handleOpenReport() {
  expanded.value = false
  showReport.value = true
}

function toggleAuthorExpanded() {
  authorExpanded.value = !authorExpanded.value
  if (authorExpanded.value) expanded.value = false
}

function handleAuthorClose() {
  authorExpanded.value = false
}

function handleOpenAuthorReport() {
  authorExpanded.value = false
  showAuthorReport.value = true
}

onMounted(() => {
  if (canView.value) {
    subscribe()
    subscribeAuthors()
  }
})
</script>

<template>
  <div v-if="canView && isAnyActive" class="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2">
    <!-- Book metadata expanded panel -->
    <div v-if="expanded" class="rounded-lg border border-border bg-popover shadow-xl">
      <BookMetadataFetchExpanded :status="status" @close="handleClose" @open-report="handleOpenReport" />
    </div>

    <!-- Author enrichment expanded panel -->
    <div v-if="authorExpanded" class="rounded-lg border border-border bg-popover shadow-xl">
      <AuthorEnrichmentExpanded :status="authorStatus" @close="handleAuthorClose" @open-report="handleOpenAuthorReport" />
    </div>

    <!-- Book metadata fetch card -->
    <button
      v-if="isBookFetchActive"
      class="relative overflow-hidden flex items-center gap-3 px-4 py-3 rounded-xl bg-card border border-border shadow-xl text-sm transition-all duration-300 hover:shadow-2xl hover:scale-[1.02] w-60"
      :class="status.paused ? 'opacity-70' : ''"
      @click="toggleExpanded"
    >
      <div class="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors duration-300" :class="bookIconWrapperClass">
        <Sparkles :size="20" class="text-violet-500" :class="[bookIconOpacity, showBookDot ? 'animate-pulse' : '']" />
      </div>
      <div class="flex flex-col items-start gap-0.5 min-w-0">
        <span class="text-xs font-semibold text-foreground leading-none">Fetching metadata</span>
        <span class="text-xs text-muted-foreground leading-none">{{ bookRemainingLabel }}</span>
        <span class="text-xs text-muted-foreground/60 leading-none truncate mt-0.5" :class="lastBookName ? '' : 'invisible'">{{
          lastBookName ?? '\u00a0'
        }}</span>
      </div>
      <!-- bottom progress bar -->
      <div v-if="status.sessionTotal > 0" class="absolute bottom-0 left-0 right-0 h-[3px] bg-muted">
        <div class="h-full bg-violet-500 transition-all duration-500" :style="{ width: `${bookProgressPercent}%` }" />
      </div>
    </button>

    <!-- Author enrichment card -->
    <button
      v-if="isAuthorActive"
      class="relative overflow-hidden flex items-center gap-3 px-4 py-3 rounded-xl bg-card border border-border shadow-xl text-sm transition-all duration-300 hover:shadow-2xl hover:scale-[1.02] w-60"
      :class="authorStatus.paused ? 'opacity-70' : ''"
      @click="toggleAuthorExpanded"
    >
      <div
        class="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors duration-300"
        :class="authorIconWrapperClass"
      >
        <Users :size="20" class="text-emerald-500" :class="[authorIconOpacity, showAuthorDot ? 'animate-pulse' : '']" />
      </div>
      <div class="flex flex-col items-start gap-0.5 min-w-0">
        <span class="text-xs font-semibold text-foreground leading-none">Enriching authors</span>
        <span class="text-xs text-muted-foreground leading-none">{{ authorRemainingLabel }}</span>
        <span class="text-xs text-muted-foreground/60 leading-none truncate mt-0.5" :class="lastAuthorName ? '' : 'invisible'">{{
          lastAuthorName ?? '\u00a0'
        }}</span>
      </div>
      <!-- bottom progress bar -->
      <div v-if="authorStatus.sessionTotal > 0" class="absolute bottom-0 left-0 right-0 h-[3px] bg-muted">
        <div class="h-full bg-emerald-500 transition-all duration-500" :style="{ width: `${authorProgressPercent}%` }" />
      </div>
    </button>

    <BookMetadataFetchReportModal v-if="showReport" @close="showReport = false" />
    <AuthorEnrichmentReportModal v-if="showAuthorReport" @close="showAuthorReport = false" />
  </div>
</template>
