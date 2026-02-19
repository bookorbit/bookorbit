<script setup lang="ts">
import { computed } from 'vue'
import { ArrowLeft } from 'lucide-vue-next'
import type { BookDetail, MetadataCandidate, MetadataProviderInfo } from '@projectx/types'
import { useMetadataDiff, type MetadataPatch } from '../../../composables/useMetadataDiff'
import { getProviderLabel } from '../../../lib/metadata-fetch'
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
    <div class="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
      <button
        class="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        @click="$emit('back')"
      >
        <ArrowLeft class="size-4" />
        Results
      </button>
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium truncate">{{ candidate.title }}</p>
        <p class="text-xs text-muted-foreground">{{ providerLabel }}</p>
      </div>
      <div class="flex gap-2 shrink-0">
        <button
          class="h-7 px-3 rounded-md border border-input text-xs hover:bg-muted transition-colors"
          @click="copyMissing"
        >
          Copy missing
        </button>
        <button
          class="h-7 px-3 rounded-md border border-input text-xs hover:bg-muted transition-colors"
          @click="copyAll"
        >
          Copy all
        </button>
      </div>
    </div>

    <!-- Column labels -->
    <div class="grid grid-cols-[1fr_40px_1fr] gap-2 px-4 py-2 bg-muted/30 border-b border-border shrink-0">
      <p class="text-xs font-medium text-muted-foreground">Current</p>
      <div />
      <p class="text-xs font-medium text-muted-foreground">{{ providerLabel }}</p>
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
    <div class="flex items-center justify-end gap-2 px-4 py-3 border-t border-border shrink-0">
      <button
        class="h-8 px-4 rounded-lg border border-input bg-background text-sm hover:bg-muted transition-colors"
        @click="$emit('back')"
      >
        Cancel
      </button>
      <button
        class="h-8 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40"
        :disabled="!hasCopied"
        @click="apply"
      >
        Apply to form
      </button>
    </div>
  </div>
</template>
