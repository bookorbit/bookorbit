<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowRight, Check, CircleCheck, ImageOff, Loader2, Maximize2, TriangleAlert, X } from '@lucide/vue'
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import type { CoverMedium, MetadataCandidate, MetadataProviderInfo } from '@bookorbit/types'
import type { CoverChoice, CoverSize } from '../../composables/useMetadataDiff'
import { getProviderColor, getProviderLabel, hideOnError, providerBadgeStyle } from '../../lib/metadata-fetch'

const props = defineProps<{
  label: string
  medium: CoverMedium
  currentUrl: string
  active: CoverChoice | null
  picked: CoverChoice | null
  choices: CoverChoice[]
  locked: boolean
  providers: MetadataProviderInfo[]
  /** The strip's own search is still running, for the other medium's cover. */
  searching?: boolean
  searchingText?: string
  /** Shown when the strip has nothing, for the other medium's cover. */
  emptyText?: string
}>()

const emit = defineEmits<{
  keep: []
  use: []
  pick: [MetadataCandidate | null]
}>()

const { t } = useI18n()
const previewOpen = ref(false)

const currentSize = ref<CoverSize | null>(null)
watch(
  () => props.currentUrl,
  () => {
    currentSize.value = null
  },
)

const ratio = computed(() => (props.medium === 'audio' ? '1/1' : '2/3'))
const frameWidth = computed(() => (props.medium === 'audio' ? 'w-[8.25rem]' : 'w-[6.5rem]'))
const shown = computed(() => props.picked ?? props.active)
const using = computed(() => props.picked !== null)
const pickedElsewhere = computed(
  () =>
    props.picked !== null && props.active !== null && props.picked.candidate !== props.active.candidate && !sameResult(props.picked, props.active),
)
const slotText = computed(() =>
  props.medium === 'audio' ? t('book.detail.editMetadata.match.cover.slotAudio') : t('book.detail.editMetadata.match.cover.slotBook'),
)

function sameResult(a: CoverChoice, b: CoverChoice): boolean {
  return a.candidate.provider === b.candidate.provider && a.candidate.providerId === b.candidate.providerId
}

function fitText(choice: CoverChoice): string {
  if (choice.broken) return t('book.detail.editMetadata.match.cover.broken')
  if (choice.fit === 'match') return t('book.detail.editMetadata.match.cover.fits')
  if (choice.fit === 'unknown') return t('book.detail.editMetadata.match.cover.unknown')
  return props.medium === 'audio'
    ? t('book.detail.editMetadata.match.cover.portraitInSquare')
    : t('book.detail.editMetadata.match.cover.squareInPortrait')
}

function fitShort(choice: CoverChoice): string {
  if (choice.broken) return t('book.detail.editMetadata.match.cover.brokenShort')
  if (choice.fit === 'match') return t('book.detail.editMetadata.match.cover.fitShort')
  if (choice.fit === 'unknown') return t('book.detail.editMetadata.match.cover.unknown')
  return props.medium === 'audio' ? t('book.detail.editMetadata.match.cover.portraitShort') : t('book.detail.editMetadata.match.cover.squareShort')
}

function fitClass(choice: CoverChoice): string {
  if (choice.broken) return 'text-destructive'
  if (choice.fit === 'match') return 'text-success'
  if (choice.fit === 'unknown') return 'text-muted-foreground'
  return 'text-warning'
}

function sizeText(size: CoverSize | null): string {
  return size ? t('book.detail.editMetadata.match.cover.size', { width: size.width, height: size.height }) : ''
}

function isPicked(choice: CoverChoice): boolean {
  return props.picked !== null && sameResult(props.picked, choice)
}

function isViewed(choice: CoverChoice): boolean {
  return props.picked === null && props.active !== null && sameResult(props.active, choice)
}

function choiceLabel(choice: CoverChoice): string {
  const provider = getProviderLabel(choice.candidate.provider, props.providers)
  return choice.size
    ? t('book.detail.editMetadata.match.cover.choiceSized', { provider, width: choice.size.width, height: choice.size.height })
    : t('book.detail.editMetadata.match.cover.choice', { provider })
}

function providerLabel(candidate: MetadataCandidate): string {
  return getProviderLabel(candidate.provider, props.providers)
}

function handleCurrentLoad(event: Event) {
  const image = event.target as HTMLImageElement
  currentSize.value = { width: image.naturalWidth, height: image.naturalHeight }
}

function openPreview() {
  previewOpen.value = true
}

function handlePreviewOpenChange(open: boolean) {
  previewOpen.value = open
}

function handleKeep() {
  emit('keep')
}

function handleUse() {
  emit('use')
}

function handlePick(choice: CoverChoice) {
  emit('pick', isPicked(choice) ? null : choice.candidate)
}
</script>

<template>
  <section class="overflow-hidden rounded-xl border border-border bg-card" :aria-label="label">
    <header class="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-border/60 py-2 ps-3.5 pe-3">
      <h4 class="text-[10.5px] font-bold tracking-[0.12em] text-muted-foreground uppercase">{{ label }}</h4>
      <span class="hidden text-[11.5px] text-muted-foreground @xl/compare:inline">{{ slotText }}</span>
      <span class="flex-1" />
      <span v-if="pickedElsewhere && picked" class="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {{ t('book.detail.editMetadata.match.cover.using') }}
        <span
          class="inline-flex h-[18px] items-center rounded-md px-1.5 text-[10.5px] font-bold"
          :style="providerBadgeStyle(picked.candidate.provider)"
          >{{ providerLabel(picked.candidate) }}</span
        >
      </span>
      <div class="flex min-w-[8.5rem] flex-wrap gap-0.5 rounded-lg border border-border/60 bg-muted p-0.5" role="radiogroup" :aria-label="label">
        <button
          type="button"
          role="radio"
          :aria-checked="!using"
          :disabled="locked"
          class="inline-flex min-h-[26px] flex-auto items-center justify-center rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:cursor-not-allowed disabled:text-muted-foreground"
          :class="!using ? 'bg-background shadow-xs ring-1 ring-border' : 'hover:enabled:bg-background/60'"
          @click="handleKeep"
        >
          {{ t('book.detail.editMetadata.match.decision.keep') }}
        </button>
        <button
          type="button"
          role="radio"
          :aria-checked="using"
          :disabled="locked || !active"
          class="inline-flex min-h-[26px] flex-auto items-center justify-center rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:cursor-not-allowed disabled:text-muted-foreground"
          :class="using ? 'bg-primary text-primary-foreground' : 'hover:enabled:bg-background/60'"
          @click="handleUse"
        >
          {{ t('book.detail.editMetadata.match.decision.use') }}
        </button>
      </div>
    </header>

    <div class="grid gap-4 p-3.5 @2xl/compare:grid-cols-[auto_minmax(0,1fr)]">
      <div class="flex items-start gap-4">
        <figure class="m-0 grid justify-items-start gap-1.5">
          <button
            type="button"
            class="group relative block overflow-hidden rounded-lg bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-default ring-1 ring-border"
            :class="[frameWidth, using ? 'grayscale-[0.6] brightness-[0.8]' : '']"
            :style="{ aspectRatio: ratio }"
            :disabled="!currentUrl"
            :aria-label="t('book.detail.editMetadata.match.cover.preview')"
            @click="openPreview"
          >
            <template v-if="currentUrl">
              <img :src="currentUrl" alt="" aria-hidden="true" class="absolute inset-0 size-full scale-125 object-cover blur-md brightness-75" />
              <img
                :src="currentUrl"
                :alt="t('book.detail.editMetadata.diff.currentCoverAlt')"
                class="relative size-full object-contain"
                @load="handleCurrentLoad"
                @error="hideOnError"
              />
            </template>
            <span v-else class="grid size-full place-items-center text-muted-foreground"><ImageOff class="size-5" aria-hidden="true" /></span>
            <span
              v-if="currentUrl"
              class="absolute inset-0 grid place-items-center bg-black/35 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
              aria-hidden="true"
            >
              <Maximize2 class="size-5" />
            </span>
          </button>
          <figcaption class="grid gap-0.5 text-[11.5px]">
            <span class="text-[9.5px] font-bold tracking-[0.1em] text-muted-foreground uppercase">{{
              t('book.detail.editMetadata.match.cover.current')
            }}</span>
            <span v-if="currentSize" class="font-mono text-[11px] tabular-nums">{{ sizeText(currentSize) }}</span>
            <span v-else-if="!currentUrl" class="text-muted-foreground">{{ t('book.detail.editMetadata.match.cover.noCurrent') }}</span>
          </figcaption>
        </figure>

        <ArrowRight class="mt-14 size-[18px] text-muted-foreground rtl:rotate-180" aria-hidden="true" />

        <figure class="m-0 grid justify-items-start gap-1.5">
          <button
            type="button"
            class="group relative block overflow-hidden rounded-lg bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-default"
            :class="[frameWidth, using ? 'ring-2 ring-primary' : 'ring-1 ring-border']"
            :style="{ aspectRatio: ratio }"
            :disabled="!shown"
            :aria-label="t('book.detail.editMetadata.match.cover.preview')"
            @click="openPreview"
          >
            <template v-if="shown">
              <img :src="shown.url" alt="" aria-hidden="true" class="absolute inset-0 size-full scale-125 object-cover blur-md brightness-75" />
              <img
                :src="shown.url"
                :alt="t('book.detail.editMetadata.diff.newCoverAlt')"
                class="relative size-full object-contain"
                @error="hideOnError"
              />
            </template>
            <span v-else class="grid size-full place-items-center text-muted-foreground"><ImageOff class="size-5" aria-hidden="true" /></span>
            <span
              v-if="shown"
              class="absolute inset-0 grid place-items-center bg-black/35 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
              aria-hidden="true"
            >
              <Maximize2 class="size-5" />
            </span>
          </button>
          <figcaption class="grid gap-0.5 text-[11.5px]">
            <span class="text-[9.5px] font-bold tracking-[0.1em] text-muted-foreground uppercase">{{
              using ? t('book.detail.editMetadata.match.cover.staged') : shown ? providerLabel(shown.candidate) : ''
            }}</span>
            <template v-if="shown">
              <span v-if="shown.size" class="font-mono text-[11px] tabular-nums">{{ sizeText(shown.size) }}</span>
              <span class="inline-flex items-center gap-1 text-[11px] font-semibold" :class="fitClass(shown)">
                <CircleCheck v-if="shown.fit === 'match' && !shown.broken" class="size-3" aria-hidden="true" />
                <TriangleAlert v-else class="size-3" aria-hidden="true" />
                {{ fitText(shown) }}
              </span>
            </template>
            <span v-else class="text-muted-foreground">{{ t('book.detail.editMetadata.match.cover.noCover') }}</span>
          </figcaption>
        </figure>
      </div>

      <div
        class="grid min-w-0 content-start gap-2 border-t border-border/60 pt-3 @2xl/compare:border-t-0 @2xl/compare:border-s @2xl/compare:ps-4 @2xl/compare:pt-0"
      >
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <span class="text-[10.5px] font-bold tracking-[0.12em] text-muted-foreground uppercase">{{
            t('book.detail.editMetadata.match.cover.strip')
          }}</span>
          <span v-if="choices.length" class="text-[11px] text-muted-foreground tabular-nums">{{
            t('book.detail.editMetadata.match.cover.stripMeta', { count: choices.length })
          }}</span>
        </div>
        <div
          v-if="choices.length"
          class="flex gap-3 overflow-x-auto p-1.5 pb-2"
          role="radiogroup"
          :aria-label="t('book.detail.editMetadata.match.cover.choose')"
        >
          <button
            v-for="choice in choices"
            :key="`${choice.candidate.provider}:${choice.candidate.providerId}`"
            type="button"
            role="radio"
            class="grid w-16 shrink-0 justify-items-center gap-1 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed"
            :aria-checked="isPicked(choice)"
            :aria-label="choiceLabel(choice)"
            :disabled="locked"
            @click="handlePick(choice)"
          >
            <span
              class="relative block w-16 overflow-hidden rounded-md bg-muted"
              :class="
                isPicked(choice)
                  ? 'ring-1 ring-border outline-2 outline-offset-2 outline-primary outline-dashed'
                  : isViewed(choice)
                    ? 'ring-1 ring-border outline-2 outline-offset-2 outline-muted-foreground outline-dashed'
                    : 'ring-1 ring-border'
              "
              :style="{ aspectRatio: ratio }"
            >
              <img :src="choice.url" alt="" class="size-full object-contain" loading="lazy" @error="hideOnError" />
              <span class="absolute inset-x-0 bottom-0 h-[3px]" :style="{ backgroundColor: getProviderColor(choice.candidate.provider) }" />
              <span
                v-if="isPicked(choice)"
                class="absolute end-1 top-1 grid size-4 place-items-center rounded-full bg-primary text-primary-foreground"
              >
                <Check class="size-2.5" aria-hidden="true" />
              </span>
            </span>
            <span v-if="choice.size" class="font-mono text-[10px] whitespace-nowrap text-muted-foreground tabular-nums"
              >{{ choice.size.width }}×{{ choice.size.height }}</span
            >
            <span class="text-[10px] font-semibold" :class="fitClass(choice)">{{ fitShort(choice) }}</span>
          </button>
        </div>
        <p v-if="searching" role="status" class="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Loader2 class="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />{{ searchingText }}
        </p>
        <p v-else-if="!choices.length" class="text-[11px] text-muted-foreground">
          {{ emptyText ?? t('book.detail.editMetadata.match.cover.noCover') }}
        </p>
      </div>
    </div>

    <DialogRoot :open="previewOpen" @update:open="handlePreviewOpenChange">
      <DialogPortal>
        <DialogOverlay
          class="fixed inset-0 z-[60] bg-scrim-media data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none"
        />
        <DialogContent
          class="fixed top-1/2 left-1/2 z-[60] max-h-[94vh] w-[min(96vw,84rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 motion-reduce:animate-none"
        >
          <DialogTitle class="sr-only">{{ t('book.detail.editMetadata.match.cover.previewTitle') }}</DialogTitle>
          <DialogDescription class="sr-only">{{ t('book.detail.editMetadata.match.cover.previewDescription') }}</DialogDescription>
          <div class="grid items-end justify-items-center gap-6 p-2" :class="currentUrl && shown ? 'sm:grid-cols-2' : ''">
            <figure v-if="currentUrl" class="m-0 grid justify-items-center gap-2">
              <img
                :src="currentUrl"
                :alt="t('book.detail.editMetadata.diff.currentCoverAlt')"
                class="max-h-[40vh] max-w-full rounded-md object-contain shadow-2xl sm:max-h-[80vh]"
                :class="using ? 'grayscale-[0.4]' : ''"
                @error="hideOnError"
              />
              <figcaption class="grid justify-items-center gap-0.5 text-center text-sm text-white">
                <span class="font-semibold">{{ t('book.detail.editMetadata.match.cover.current') }}</span>
                <span v-if="currentSize" class="font-mono text-xs text-white/75 tabular-nums">{{ sizeText(currentSize) }}</span>
              </figcaption>
            </figure>
            <figure v-if="shown" class="m-0 grid justify-items-center gap-2">
              <img
                :src="shown.url"
                :alt="t('book.detail.editMetadata.diff.newCoverAlt')"
                class="max-h-[40vh] max-w-full rounded-md object-contain shadow-2xl sm:max-h-[80vh]"
                :class="using ? 'ring-2 ring-primary' : ''"
                @error="hideOnError"
              />
              <figcaption class="grid justify-items-center gap-0.5 text-center text-sm text-white">
                <span class="font-semibold">{{ using ? t('book.detail.editMetadata.match.cover.staged') : providerLabel(shown.candidate) }}</span>
                <span class="text-xs text-white/75">
                  <span v-if="shown.size" class="font-mono tabular-nums">{{ sizeText(shown.size) }} · </span>{{ fitText(shown) }}
                </span>
              </figcaption>
            </figure>
          </div>
          <DialogClose
            class="absolute end-2 top-2 grid size-9 place-items-center rounded-full border border-border bg-background text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            :aria-label="t('common.close')"
          >
            <X class="size-4" aria-hidden="true" />
          </DialogClose>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  </section>
</template>
