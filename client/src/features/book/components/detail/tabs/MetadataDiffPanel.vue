<script setup lang="ts">
import { computed, inject, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { ArrowLeft, CopyCheck, Copy, CheckCheck, Eye, EyeOff, Info } from 'lucide-vue-next'
import type { MetadataCandidate, MetadataProviderInfo, MetadataProviderKey, MetadataSource, ProviderIds } from '@projectx/types'
import { useMetadataDiff, type DiffFieldKey, type MetadataPatch } from '../../../composables/useMetadataDiff'
import { getProviderColor, getProviderLabel, hideOnError, providerActivePillStyle } from '../../../lib/metadata-fetch'
import MetadataDiffRow from './MetadataDiffRow.vue'
import { COVER_ASPECT_RATIO_KEY, DEFAULT_COVER_ASPECT_RATIO } from '../../../lib/cover-aspect-ratio'

const props = defineProps<{
  current: MetadataSource
  candidates: MetadataCandidate[]
  initialCandidate: MetadataCandidate
  providers: MetadataProviderInfo[]
  filteredResults: MetadataCandidate[]
  backLabel?: string
  currentCoverUrl?: string
  providerIds?: ProviderIds
}>()

const emit = defineEmits<{
  back: []
  apply: [{ formPatch: MetadataPatch; coverUrl?: string }]
}>()

const coverAspectRatio = inject(COVER_ASPECT_RATIO_KEY, ref(DEFAULT_COVER_ASPECT_RATIO))

const activeProvider = ref<MetadataProviderKey>(props.initialCandidate.provider)
const showUnchanged = ref(false)
const showSwitchHint = ref(false)

let switchHintTimer: ReturnType<typeof setTimeout> | null = null

interface ProviderResultMeta {
  total: number
  selectedIndex: number
}

// Tracks which specific result the user has picked per provider tab
const selectedPerProvider = reactive(new Map<MetadataProviderKey, MetadataCandidate>())
selectedPerProvider.set(props.initialCandidate.provider, props.initialCandidate)
for (const candidate of props.filteredResults) {
  if (!selectedPerProvider.has(candidate.provider)) {
    selectedPerProvider.set(candidate.provider, candidate)
  }
}

const representativeCandidates = computed<MetadataCandidate[]>(() => {
  const out: MetadataCandidate[] = []
  const seen = new Set<MetadataProviderKey>()

  // initialCandidate's provider always first
  const initSelected = selectedPerProvider.get(props.initialCandidate.provider) ?? props.initialCandidate
  out.push(initSelected)
  seen.add(initSelected.provider)

  for (const candidate of props.filteredResults) {
    if (!seen.has(candidate.provider)) {
      seen.add(candidate.provider)
      out.push(selectedPerProvider.get(candidate.provider) ?? candidate)
    }
  }

  return out
})

watch(representativeCandidates, (list) => {
  if (!list.find((candidate) => candidate.provider === activeProvider.value)) {
    activeProvider.value = list[0]?.provider ?? props.initialCandidate.provider
  }
})

const activeCandidate = computed(
  () =>
    representativeCandidates.value.find((candidate) => candidate.provider === activeProvider.value) ??
    representativeCandidates.value[0] ??
    props.initialCandidate,
)

const { fields, picksPerProvider, toggleField, pickFieldFromProvider, clearPicksForProvider, copyAll, copyMissing, buildPatch, hasCopied } =
  useMetadataDiff(
    props.current,
    representativeCandidates,
    activeProvider,
    computed(() => props.providers),
    props.currentCoverUrl,
    computed(() => props.providerIds),
  )

const activeProviderLabel = computed(() => getProviderLabel(activeProvider.value, props.providers))
const resultsForActiveProvider = computed(() => props.filteredResults.filter((candidate) => candidate.provider === activeProvider.value))

const selectedFieldCount = computed(() => {
  let total = 0
  for (const count of picksPerProvider.value.values()) {
    total += count
  }
  return total
})

const selectedCountLabel = computed(() => {
  if (!selectedFieldCount.value) return 'No fields selected'
  return `${selectedFieldCount.value} field${selectedFieldCount.value === 1 ? '' : 's'} selected`
})

const providerResultMeta = computed(() => {
  const meta = new Map<MetadataProviderKey, ProviderResultMeta>()
  for (const candidate of representativeCandidates.value) {
    const matches = props.filteredResults.filter((c) => c.provider === candidate.provider)
    const selected = selectedPerProvider.get(candidate.provider) ?? candidate
    const idx = matches.findIndex((match) => isSameCandidate(match, selected))
    meta.set(candidate.provider, {
      total: matches.length || 1,
      selectedIndex: idx >= 0 ? idx + 1 : 1,
    })
  }
  return meta
})

const activeResultMeta = computed(
  () =>
    providerResultMeta.value.get(activeProvider.value) ?? {
      total: 1,
      selectedIndex: 1,
    },
)

const visibleFields = computed(() => fields.value.filter((field) => showUnchanged.value || field.hasDiff || !field.bookValue))

function isSameCandidate(a: MetadataCandidate, b: MetadataCandidate): boolean {
  if (a.provider !== b.provider) return false
  if (a.providerId && b.providerId) return a.providerId === b.providerId
  return a === b
}

function isActiveProvider(provider: MetadataProviderKey): boolean {
  return activeProvider.value === provider
}

function getProviderAvailableCount(provider: MetadataProviderKey): number {
  return providerResultMeta.value.get(provider)?.total ?? 0
}

function isSelectedForTab(candidate: MetadataCandidate): boolean {
  const selected = selectedPerProvider.get(candidate.provider)
  if (!selected) return false
  return isSameCandidate(selected, candidate)
}

function clearSwitchHintTimer() {
  if (switchHintTimer) {
    clearTimeout(switchHintTimer)
    switchHintTimer = null
  }
}

function showResultSwitchHint() {
  showSwitchHint.value = true
  clearSwitchHintTimer()
  switchHintTimer = setTimeout(() => {
    showSwitchHint.value = false
    switchHintTimer = null
  }, 2800)
}

function selectResultForTab(candidate: MetadataCandidate) {
  const current = selectedPerProvider.get(candidate.provider)
  if (current && isSameCandidate(current, candidate)) return
  const hadSelections = (picksPerProvider.value.get(candidate.provider) ?? 0) > 0
  selectedPerProvider.set(candidate.provider, candidate)
  clearPicksForProvider(candidate.provider)
  if (hadSelections) showResultSwitchHint()
}

function setActiveProvider(provider: MetadataProviderKey) {
  activeProvider.value = provider
}

function handlePickFromProvider(key: DiffFieldKey, provider: MetadataProviderKey) {
  pickFieldFromProvider(key, provider)
}

function handleCopyAll() {
  copyAll()
}

function handleCopyMissing() {
  copyMissing()
}

function toggleShowUnchanged() {
  showUnchanged.value = !showUnchanged.value
}

function goBack() {
  emit('back')
}

function apply() {
  emit('apply', buildPatch())
}

onBeforeUnmount(() => {
  clearSwitchHintTimer()
})
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Header -->
    <div class="shrink-0 border-b border-border bg-card/50 px-4 py-3">
      <div class="flex items-center gap-2">
        <button
          class="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0 group h-8 px-2.5 rounded-lg border border-border bg-background"
          @click="goBack"
        >
          <ArrowLeft class="size-4 transition-transform group-hover:-translate-x-0.5" />
          {{ backLabel ?? 'Results' }}
        </button>

        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 overflow-x-auto whitespace-nowrap pb-0.5">
            <button
              v-for="candidate in representativeCandidates"
              :key="candidate.provider"
              class="h-6 px-2.5 rounded-full border inline-flex items-center gap-1.5 text-xs font-medium transition-all active:scale-[0.99] shrink-0"
              :class="
                isActiveProvider(candidate.provider)
                  ? 'text-foreground'
                  : 'border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground'
              "
              :style="isActiveProvider(candidate.provider) ? providerActivePillStyle(candidate.provider) : {}"
              @click="setActiveProvider(candidate.provider)"
            >
              <span>{{ getProviderLabel(candidate.provider, providers) }}</span>
              <span class="inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full text-[10px] font-semibold bg-black/10">
                {{ getProviderAvailableCount(candidate.provider) }}
              </span>
            </button>
          </div>
        </div>
      </div>

      <!-- Within-provider result picker -->
      <div v-if="resultsForActiveProvider.length > 1" class="mt-2.5">
        <div class="flex items-center justify-between gap-2 mb-1.5">
          <p class="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{{ activeProviderLabel }} matches</p>
          <p class="text-[10px] text-muted-foreground">Selected {{ activeResultMeta.selectedIndex }} of {{ activeResultMeta.total }}</p>
        </div>
        <div class="flex items-center gap-2 overflow-x-auto pb-0.5">
          <button
            v-for="(candidate, index) in resultsForActiveProvider"
            :key="candidate.providerId ?? index"
            class="shrink-0 w-52 rounded-lg border bg-background/70 px-2 py-1.5 flex items-center gap-2 text-left transition-all active:scale-[0.98]"
            :class="isSelectedForTab(candidate) ? 'border-primary/50 bg-primary/6' : 'border-border/60 hover:border-border'"
            :style="isSelectedForTab(candidate) ? { boxShadow: `0 0 0 1px ${getProviderColor(candidate.provider)}` } : {}"
            @click="selectResultForTab(candidate)"
          >
            <span class="relative w-10 shrink-0 rounded-md overflow-hidden bg-muted ring-1 ring-border/70" :style="{ aspectRatio: coverAspectRatio }">
              <img v-if="candidate.coverUrl" :src="candidate.coverUrl" alt="" class="w-full h-full object-cover" @error="hideOnError" />
              <span v-else class="block w-full h-full bg-muted-foreground/10" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-xs font-medium text-foreground line-clamp-1">{{ candidate.title }}</span>
              <span class="block text-[10px] text-muted-foreground line-clamp-1">
                {{ candidate.publishedYear ?? 'Year unknown' }} - {{ index + 1 }} of {{ resultsForActiveProvider.length }}
              </span>
            </span>
          </button>
        </div>
      </div>

      <p v-if="showSwitchHint" class="mt-2 text-[11px] text-muted-foreground flex items-center gap-1.5">
        <Info class="size-3.5" />
        Switched result. Previous selections from this provider were cleared.
      </p>
    </div>

    <!-- Diff rows -->
    <div class="flex-1 overflow-y-auto px-4">
      <div class="sticky top-0 z-10 -mx-4 px-4 py-2.5 border-b border-border bg-background/95 backdrop-blur-sm">
        <div class="flex items-center gap-1.5 pb-1">
          <div class="min-w-0 flex items-center gap-1.5 overflow-x-auto whitespace-nowrap pr-2">
            <p v-if="hasCopied" class="shrink-0 text-xs text-muted-foreground inline-flex items-center gap-1.5">
              <CheckCheck class="size-3.5 text-primary" />
              {{ selectedCountLabel }}
            </p>
            <p v-else class="shrink-0 text-xs text-muted-foreground">Select fields to apply</p>
            <button
              class="flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs font-medium hover:bg-amber-500/20 transition-all active:scale-95"
              @click="handleCopyMissing"
            >
              <Copy class="size-3" />
              Copy Missing
            </button>
            <button
              class="flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-primary/40 bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-all active:scale-95"
              @click="handleCopyAll"
            >
              <CopyCheck class="size-3" />
              Copy All
            </button>
          </div>
          <button
            class="h-7 px-2.5 rounded-lg border border-border bg-background text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-all active:scale-95 inline-flex items-center gap-1.5 shrink-0 ml-auto"
            @click="toggleShowUnchanged"
          >
            <EyeOff v-if="showUnchanged" class="size-3.5" />
            <Eye v-else class="size-3.5" />
            {{ showUnchanged ? 'Hide unchanged' : 'Show unchanged' }}
          </button>
        </div>

        <div class="grid grid-cols-[1fr_auto_1fr] gap-2 mt-2.5">
          <div class="flex items-center gap-1.5">
            <div class="size-1.5 rounded-full bg-muted-foreground/40" />
            <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Current</p>
          </div>
          <div class="w-11" />
          <div class="flex items-center gap-1.5 min-w-0 overflow-hidden">
            <div class="size-1.5 rounded-full" :style="{ backgroundColor: getProviderColor(activeProvider) }" />
            <p class="text-xs font-semibold tracking-wider shrink-0" :style="{ color: getProviderColor(activeProvider) }">
              {{ activeProviderLabel }}
            </p>
            <p class="text-xs text-muted-foreground truncate min-w-0">({{ activeCandidate.title }})</p>
          </div>
        </div>
      </div>

      <MetadataDiffRow
        v-for="field in visibleFields"
        :key="field.key"
        :field="field"
        :active-provider="activeProvider"
        :providers="providers"
        @toggle="toggleField"
        @pick-from-provider="handlePickFromProvider"
      />
      <p v-if="visibleFields.length === 0" class="py-8 text-center text-sm text-muted-foreground">
        {{ showUnchanged ? 'No metadata available from this source.' : 'No changed or missing fields. Use Show unchanged to inspect everything.' }}
      </p>
    </div>

    <!-- Footer -->
    <div class="flex flex-wrap items-center justify-end gap-2 px-4 py-3 border-t border-border shrink-0 bg-card/30">
      <div class="flex flex-wrap items-center gap-2">
        <button class="h-8 px-3 rounded-lg border border-border bg-background text-sm hover:bg-muted transition-all active:scale-95" @click="goBack">
          Cancel
        </button>
        <button
          class="relative h-8 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium transition-all disabled:opacity-40 hover:opacity-90 active:scale-95 overflow-hidden group"
          :disabled="!hasCopied"
          @click="apply"
        >
          <span class="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity" />
          Apply to form
        </button>
      </div>
    </div>
  </div>
</template>
