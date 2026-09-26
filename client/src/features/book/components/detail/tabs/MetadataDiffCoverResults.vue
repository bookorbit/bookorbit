<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Loader2 } from '@lucide/vue'
import type { CoverMedium, MetadataCandidate, MetadataProviderInfo } from '@bookorbit/types'
import { getProviderLabel, hideOnError, providerBadgeStyle, toDisplayCoverUrl } from '../../../lib/metadata-fetch'

const props = defineProps<{
  medium: CoverMedium
  choices: MetadataCandidate[]
  active: MetadataCandidate | null
  picked: MetadataCandidate | null
  providers: MetadataProviderInfo[]
  searching: boolean
}>()

const emit = defineEmits<{ select: [candidate: MetadataCandidate] }>()

const { t } = useI18n()

const aspectRatio = computed(() => (props.medium === 'audio' ? '1/1' : '2/3'))
const copy = computed(() =>
  props.medium === 'audio'
    ? {
        group: t('book.detail.editMetadata.diffPanel.secondCover.audioResults'),
        searching: t('book.detail.editMetadata.diffPanel.secondCover.searchingAudio'),
        none: t('book.detail.editMetadata.diffPanel.secondCover.noAudio'),
      }
    : {
        group: t('book.detail.editMetadata.diffPanel.secondCover.bookResults'),
        searching: t('book.detail.editMetadata.diffPanel.secondCover.searchingBook'),
        none: t('book.detail.editMetadata.diffPanel.secondCover.noBook'),
      },
)

function providerLabel(candidate: MetadataCandidate): string {
  return getProviderLabel(candidate.provider, props.providers)
}

function selectChoice(candidate: MetadataCandidate) {
  emit('select', candidate)
}
</script>

<template>
  <div class="mt-2.5">
    <div v-if="choices.length" role="group" :aria-label="copy.group" class="flex items-center gap-1.5 overflow-x-auto p-0.5">
      <button
        v-for="(candidate, index) in choices"
        :key="`${candidate.provider}:${candidate.providerId}:${index}`"
        type="button"
        class="relative w-12 shrink-0 overflow-hidden rounded-md bg-muted ring-1 transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        :class="candidate === active ? 'ring-2 ring-primary' : 'ring-border hover:ring-foreground/40'"
        :style="{ aspectRatio }"
        :aria-pressed="candidate === active"
        :aria-label="
          t('book.detail.editMetadata.diffPanel.secondCover.showCover', {
            provider: providerLabel(candidate),
            index: index + 1,
            total: choices.length,
          })
        "
        @click="selectChoice(candidate)"
      >
        <img :src="toDisplayCoverUrl(candidate.coverUrl)" alt="" class="h-full w-full object-contain" @error="hideOnError" />
        <span
          class="absolute inset-x-0.5 bottom-0.5 truncate rounded px-0.5 text-center text-[8px] font-bold"
          :style="providerBadgeStyle(candidate.provider)"
          aria-hidden="true"
        >
          {{ providerLabel(candidate) }}
        </span>
        <span
          v-if="candidate === picked"
          class="absolute end-0.5 top-0.5 flex size-3.5 items-center justify-center rounded-full bg-primary text-primary-foreground"
          aria-hidden="true"
        >
          <Check class="size-2.5" />
        </span>
      </button>
    </div>
    <p v-if="searching" role="status" class="mt-1.5 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <Loader2 class="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      {{ copy.searching }}
    </p>
    <p v-else-if="!choices.length" class="mt-1.5 text-[11px] text-muted-foreground">{{ copy.none }}</p>
  </div>
</template>
