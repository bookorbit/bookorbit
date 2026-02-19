<script setup lang="ts">
import { computed } from 'vue'
import { ArrowLeft, CopyCheck, Copy, CheckCheck } from 'lucide-vue-next'
import type { BookDetail, MetadataCandidate, MetadataProviderInfo } from '@projectx/types'
import { useMetadataDiff, type MetadataPatch } from '../../../composables/useMetadataDiff'
import { getProviderLabel, providerBadgeStyle, getProviderColor } from '../../../lib/metadata-fetch'
import MetadataDiffRow from './MetadataDiffRow.vue'

const props = defineProps<{
  book: BookDetail
  candidate: MetadataCandidate
  providers: MetadataProviderInfo[]
}>()

const emit = defineEmits<{
  back: []
  apply: [{ formPatch: MetadataPatch; coverUrl?: string }]
}>()

const providerLabel = computed(() => getProviderLabel(props.candidate.provider, props.providers))

const { fields, toggleField, copyAll, copyMissing, buildPatch, hasCopied } = useMetadataDiff(
  props.book,
  props.candidate,
)

function apply() {
  emit('apply', buildPatch())
}
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Header -->
    <div class="flex items-start gap-3 px-4 py-3 border-b border-border shrink-0 bg-card/50">
      <button
        class="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mt-0.5 shrink-0 group"
        @click="$emit('back')"
      >
        <ArrowLeft class="size-4 transition-transform group-hover:-translate-x-0.5" />
        Results
      </button>
      <div class="flex-1 min-w-0">
        <p class="text-sm font-semibold truncate leading-snug">{{ candidate.title }}</p>
        <div class="flex items-center gap-1.5 mt-0.5">
          <span
            class="text-[10px] font-semibold px-2 py-0.5 rounded-full"
            :style="providerBadgeStyle(candidate.provider)"
          >
            {{ providerLabel }}
          </span>
        </div>
      </div>
      <div class="flex gap-1.5 shrink-0">
        <button
          class="flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all active:scale-95"
          @click="copyMissing"
        >
          <Copy class="size-3" />
          Missing
        </button>
        <button
          class="flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all active:scale-95"
          @click="copyAll"
        >
          <CopyCheck class="size-3" />
          All
        </button>
      </div>
    </div>

    <!-- Column labels -->
    <div class="grid grid-cols-[1fr_40px_1fr] gap-2 px-4 py-2 border-b border-border shrink-0">
      <div class="flex items-center gap-1.5">
        <div class="size-1.5 rounded-full bg-muted-foreground/40" />
        <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Current</p>
      </div>
      <div />
      <div class="flex items-center gap-1.5">
        <div class="size-1.5 rounded-full" :style="{ backgroundColor: getProviderColor(candidate.provider) }" />
        <p class="text-xs font-semibold uppercase tracking-wider" :style="{ color: getProviderColor(candidate.provider) }">{{ providerLabel }}</p>
      </div>
    </div>

    <!-- Diff rows -->
    <div class="flex-1 overflow-y-auto px-4">
      <MetadataDiffRow
        v-for="field in fields"
        :key="field.key"
        :field="field"
        @toggle="toggleField"
      />
      <p v-if="fields.length === 0" class="py-8 text-center text-sm text-muted-foreground">
        No metadata available from this source.
      </p>
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
