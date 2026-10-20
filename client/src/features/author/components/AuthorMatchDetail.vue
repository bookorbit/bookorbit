<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronLeft, ExternalLink, Loader2, Pin } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { providerBadgeStyle, toDisplayCoverUrl, hideOnError } from '@/features/book/lib/metadata-fetch'
import type { AuthorMatchEntry } from '../composables/useAuthorMatchPicker'
import { isSafeWebsite, lifeDateLabel } from '../lib/author-facts'
import { authorInitials } from '../lib/author-identity'
import { authorProviderLabel, authorProviderSourceUrl } from '../lib/author-metadata-match'

const props = defineProps<{
  entry: AuthorMatchEntry | null
  loading: boolean
  current: boolean
  pinned: boolean
  busy: boolean
}>()

const emit = defineEmits<{ use: []; unpin: []; back: [] }>()

const { t } = useI18n()

const candidate = computed(() => props.entry?.candidate ?? null)
const providerLabel = computed(() => (candidate.value ? authorProviderLabel(candidate.value.provider) : ''))
const imageUrl = computed(() => toDisplayCoverUrl(candidate.value?.imageUrl))
const initials = computed(() => authorInitials(candidate.value?.name ?? ''))
const bornLabel = computed(() => lifeDateLabel(candidate.value?.birthDate, candidate.value?.birthYear))
const diedLabel = computed(() => lifeDateLabel(candidate.value?.deathDate, candidate.value?.deathYear))
const website = computed(() => (isSafeWebsite(candidate.value?.website) ? candidate.value!.website! : null))
const genres = computed(() => candidate.value?.genres ?? [])
const sourceUrl = computed(() => {
  const value = candidate.value
  if (!value) return null
  return isSafeWebsite(value.sourceUrl) ? value.sourceUrl : authorProviderSourceUrl(value.provider, value.providerId)
})
const showUnpin = computed(() => props.current && props.pinned)

function handleUse() {
  emit('use')
}

function handleUnpin() {
  emit('unpin')
}

function handleBack() {
  emit('back')
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="flex items-center border-b border-border px-3 py-2 md:hidden">
      <button
        type="button"
        class="inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        @click="handleBack"
      >
        <ChevronLeft class="size-4" aria-hidden="true" />
        {{ t('author.match.detail.back') }}
      </button>
    </div>

    <p v-if="!candidate" class="m-auto max-w-xs p-6 text-center text-sm text-muted-foreground">{{ t('author.match.detail.empty') }}</p>

    <template v-else>
      <div class="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
        <div class="flex items-start gap-4">
          <span class="relative block h-32 w-24 shrink-0 overflow-hidden rounded-lg bg-muted ring-1 ring-border">
            <img v-if="imageUrl" :src="imageUrl" alt="" class="size-full object-cover" @error="hideOnError" />
            <span v-else class="grid size-full place-items-center text-2xl font-semibold text-primary" aria-hidden="true">{{ initials }}</span>
          </span>
          <div class="min-w-0">
            <h3 class="text-lg font-semibold leading-snug [overflow-wrap:anywhere] text-foreground">{{ candidate.name }}</h3>
            <span
              class="mt-1 inline-flex h-[18px] items-center rounded-md px-1.5 text-[10.5px] font-bold"
              :style="providerBadgeStyle(candidate.provider)"
            >
              {{ providerLabel }}
            </span>
            <dl class="mt-3 space-y-1 text-sm">
              <div v-if="bornLabel" class="flex gap-1.5">
                <dt class="text-muted-foreground">{{ t('author.header.born') }}</dt>
                <dd class="text-foreground">{{ bornLabel }}</dd>
              </div>
              <div v-if="diedLabel" class="flex gap-1.5">
                <dt class="text-muted-foreground">{{ t('author.header.died') }}</dt>
                <dd class="text-foreground">{{ diedLabel }}</dd>
              </div>
              <div v-if="website" class="flex min-w-0 gap-1.5">
                <dt class="text-muted-foreground">{{ t('author.header.website') }}</dt>
                <dd class="min-w-0 truncate text-foreground">{{ website }}</dd>
              </div>
              <div v-if="genres.length" class="flex min-w-0 gap-1.5">
                <dt class="text-muted-foreground">{{ t('author.header.genres') }}</dt>
                <dd class="min-w-0 text-foreground">{{ genres.join(', ') }}</dd>
              </div>
            </dl>
            <a
              v-if="sourceUrl"
              :href="sourceUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="mt-3 inline-flex items-center gap-1 text-sm text-foreground underline underline-offset-2"
            >
              {{ t('author.match.detail.viewOn', { provider: providerLabel }) }}
              <ExternalLink class="size-3.5" aria-hidden="true" />
            </a>
          </div>
        </div>

        <p v-if="loading" class="mt-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground" role="status">
          <Loader2 class="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          {{ t('author.match.detail.loading') }}
        </p>
        <p v-if="candidate.description" class="mt-4 text-sm leading-6 whitespace-pre-line text-foreground">{{ candidate.description }}</p>
        <p v-else-if="!loading" class="mt-4 text-sm text-muted-foreground">{{ t('author.match.detail.noBio') }}</p>
      </div>

      <footer class="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
        <p v-if="current" class="me-auto flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <Pin v-if="pinned" class="size-3.5 shrink-0" aria-hidden="true" />
          {{ pinned ? t('author.match.detail.pinnedHint') : t('author.match.detail.currentHint') }}
        </p>
        <Button v-if="showUnpin" variant="outline" :disabled="busy" @click="handleUnpin">{{ t('author.match.detail.unpin') }}</Button>
        <Button v-else :disabled="busy" @click="handleUse">
          <Loader2 v-if="busy" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
          {{ t('author.match.detail.use') }}
        </Button>
      </footer>
    </template>
  </div>
</template>
