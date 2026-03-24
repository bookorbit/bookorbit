<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ArrowLeft, CopyCheck, Copy, CheckCheck } from 'lucide-vue-next'
import type { MetadataCandidate, MetadataProviderInfo, MetadataProviderKey, MetadataSource, ProviderIds } from '@projectx/types'
import { useMetadataDiff, type DiffFieldKey, type MetadataPatch } from '../../../composables/useMetadataDiff'
import { getProviderLabel, getProviderColor, hideOnError, providerBadgeStyle, providerActivePillStyle } from '../../../lib/metadata-fetch'
import MetadataDiffRow from './MetadataDiffRow.vue'

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

const activeProvider = ref<MetadataProviderKey>(props.initialCandidate.provider)

// Tracks which specific result the user has picked per provider tab
const selectedPerProvider = reactive(new Map<MetadataProviderKey, MetadataCandidate>())
selectedPerProvider.set(props.initialCandidate.provider, props.initialCandidate)
for (const c of props.filteredResults) {
  if (!selectedPerProvider.has(c.provider)) {
    selectedPerProvider.set(c.provider, c)
  }
}

const representativeCandidates = computed<MetadataCandidate[]>(() => {
  const out: MetadataCandidate[] = []
  const seen = new Set<MetadataProviderKey>()

  // initialCandidate's provider always first
  const initSelected = selectedPerProvider.get(props.initialCandidate.provider) ?? props.initialCandidate
  out.push(initSelected)
  seen.add(initSelected.provider)

  for (const c of props.filteredResults) {
    if (!seen.has(c.provider)) {
      seen.add(c.provider)
      out.push(selectedPerProvider.get(c.provider) ?? c)
    }
  }

  return out
})

watch(representativeCandidates, (list) => {
  if (!list.find((c) => c.provider === activeProvider.value)) {
    activeProvider.value = list[0]?.provider ?? props.initialCandidate.provider
  }
})

const activeCandidate = computed(
  () => representativeCandidates.value.find((c) => c.provider === activeProvider.value) ?? representativeCandidates.value[0],
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

const hasMultipleProviders = computed(() => representativeCandidates.value.length > 1)

const resultsForActiveProvider = computed(() => props.filteredResults.filter((c) => c.provider === activeProvider.value))

function isSelectedForTab(c: MetadataCandidate): boolean {
  const selected = selectedPerProvider.get(c.provider)
  return !!selected && selected.providerId === c.providerId
}

function selectResultForTab(c: MetadataCandidate) {
  selectedPerProvider.set(c.provider, c)
  clearPicksForProvider(c.provider)
}

function setActiveProvider(provider: MetadataProviderKey) {
  activeProvider.value = provider
}

function handlePickFromProvider(key: DiffFieldKey, provider: MetadataProviderKey) {
  pickFieldFromProvider(key, provider)
}

function apply() {
  emit('apply', buildPatch())
}
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Header -->
    <div class="flex flex-col shrink-0 border-b border-border bg-card/50">
      <!-- Top row -->
      <div class="flex items-start gap-3 px-4 py-3">
        <button
          class="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mt-0.5 shrink-0 group"
          @click="$emit('back')"
        >
          <ArrowLeft class="size-4 transition-transform group-hover:-translate-x-0.5" />
          {{ backLabel ?? 'Results' }}
        </button>
        <div v-if="activeCandidate.coverUrl" class="shrink-0 w-8 rounded overflow-hidden bg-muted ring-1 ring-border" style="aspect-ratio: 2/3">
          <img
            :src="activeCandidate.coverUrl"
            alt=""
            class="w-full h-full object-cover"
            @error="($event.target as HTMLImageElement).style.display = 'none'"
          />
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-semibold truncate leading-snug">{{ activeCandidate.title }}</p>
          <div class="flex items-center gap-1.5 mt-0.5">
            <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full" :style="providerBadgeStyle(activeCandidate.provider)">
              {{ getProviderLabel(activeCandidate.provider, providers) }}
            </span>
          </div>
        </div>
        <div class="flex gap-1.5 shrink-0">
          <button
            class="flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs font-medium hover:bg-amber-500/20 transition-all active:scale-95"
            @click="copyMissing"
          >
            <Copy class="size-3" />
            Copy Missing
          </button>
          <button
            class="flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-primary/40 bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-all active:scale-95"
            @click="copyAll"
          >
            <CopyCheck class="size-3" />
            Copy All
          </button>
        </div>
      </div>

      <!-- Provider tabs -->
      <div v-if="hasMultipleProviders" class="flex items-center gap-1.5 px-4 pb-2.5 overflow-x-auto">
        <button
          v-for="c in representativeCandidates"
          :key="c.provider"
          class="relative flex items-center gap-1.5 h-6 px-2.5 rounded-full text-xs font-medium transition-all shrink-0 active:scale-95"
          :style="activeProvider === c.provider ? providerActivePillStyle(c.provider) : {}"
          :class="activeProvider !== c.provider ? 'bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80' : ''"
          @click="setActiveProvider(c.provider)"
        >
          {{ getProviderLabel(c.provider, providers) }}
          <span
            v-if="(picksPerProvider.get(c.provider) ?? 0) > 0"
            class="inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full text-[10px] font-semibold bg-black/10"
          >
            {{ picksPerProvider.get(c.provider) }}
          </span>
        </button>
      </div>

      <!-- Within-tab result picker (shown when active provider has multiple results) -->
      <div v-if="resultsForActiveProvider.length > 1" class="flex items-center gap-2 px-4 pb-2.5 overflow-x-auto">
        <p class="text-[10px] text-muted-foreground shrink-0">Result:</p>
        <button
          v-for="(c, i) in resultsForActiveProvider"
          :key="c.providerId ?? i"
          class="shrink-0 rounded-md overflow-hidden bg-muted ring-1 transition-all active:scale-95"
          :class="isSelectedForTab(c) ? 'ring-2' : 'ring-border/60 hover:ring-border'"
          :style="isSelectedForTab(c) ? { outline: 'none', boxShadow: `0 0 0 2px ${getProviderColor(c.provider)}` } : {}"
          :title="`${c.title}${c.publishedYear ? ' · ' + c.publishedYear : ''}`"
          style="width: 28px; aspect-ratio: 2/3"
          @click="selectResultForTab(c)"
        >
          <img v-if="c.coverUrl" :src="c.coverUrl" alt="" class="w-full h-full object-cover" @error="hideOnError" />
          <div v-else class="w-full h-full bg-muted-foreground/10" />
        </button>
      </div>
    </div>

    <!-- Column labels -->
    <div class="grid grid-cols-[1fr_auto_1fr] gap-2 px-4 py-2 border-b border-border shrink-0">
      <div class="flex items-center gap-1.5">
        <div class="size-1.5 rounded-full bg-muted-foreground/40" />
        <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Current</p>
      </div>
      <div class="w-11" />
      <div class="flex items-center gap-1.5">
        <div class="size-1.5 rounded-full" :style="{ backgroundColor: getProviderColor(activeProvider) }" />
        <p class="text-xs font-semibold uppercase tracking-wider" :style="{ color: getProviderColor(activeProvider) }">
          {{ getProviderLabel(activeProvider, providers) }}
        </p>
      </div>
    </div>

    <!-- Diff rows -->
    <div class="flex-1 overflow-y-auto px-4">
      <MetadataDiffRow
        v-for="field in fields"
        :key="field.key"
        :field="field"
        :active-provider="activeProvider"
        :providers="providers"
        @toggle="toggleField"
        @pick-from-provider="handlePickFromProvider"
      />
      <p v-if="fields.length === 0" class="py-8 text-center text-sm text-muted-foreground">No metadata available from this source.</p>
    </div>

    <!-- Footer -->
    <div class="flex items-center justify-between gap-2 px-4 py-3 border-t border-border shrink-0 bg-card/30">
      <p v-if="hasCopied" class="text-xs text-muted-foreground flex items-center gap-1.5">
        <CheckCheck class="size-3.5 text-primary" />
        Fields selected for import
      </p>
      <div v-else class="text-xs text-muted-foreground">Select fields to apply</div>
      <div class="flex gap-2">
        <button
          class="h-8 px-3 rounded-lg border border-border bg-background text-sm hover:bg-muted transition-all active:scale-95"
          @click="$emit('back')"
        >
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
