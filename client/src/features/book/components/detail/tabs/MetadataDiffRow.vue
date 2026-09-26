<script setup lang="ts">
import { computed, inject, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, RotateCcw, CheckCircle2, X, ZoomIn, Layers } from '@lucide/vue'
import type { MetadataProviderInfo, MetadataProviderKey } from '@bookorbit/types'
import type { DiffField, DiffFieldKey, GenreWriteMode } from '../../../composables/useMetadataDiff'
import { hideOnError, providerBadgeStyle } from '../../../lib/metadata-fetch'
import { DialogClose, DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { COVER_ASPECT_RATIO_KEY, DEFAULT_COVER_ASPECT_RATIO } from '../../../lib/cover-aspect-ratio'
import BookCoverPlaceholder from '@/features/book/components/BookCoverPlaceholder.vue'

const props = defineProps<{
  field: DiffField
  activeProvider: MetadataProviderKey
  providers: MetadataProviderInfo[]
  bookSeed?: string
  bookAuthorLine?: string | null
  candidateSeed?: string
  candidateAuthorLine?: string | null
  genreWriteMode?: GenreWriteMode
}>()

const emit = defineEmits<{
  toggle: [DiffFieldKey]
  pickFromProvider: [key: DiffFieldKey, provider: MetadataProviderKey]
  'update:genreWriteMode': [mode: GenreWriteMode]
}>()

const { t } = useI18n()
const libraryAspectRatio = inject(COVER_ASPECT_RATIO_KEY, ref(DEFAULT_COVER_ASPECT_RATIO))
/** A cover row's frames take its slot's shape; without a slot they follow the library. */
const coverAspectRatio = computed(() => {
  if (props.field.coverMedium === 'audio') return '1/1'
  if (props.field.coverMedium === 'ebook') return '2/3'
  return libraryAspectRatio.value
})
const isAudioCover = computed(() => props.field.coverMedium === 'audio')
const coverShapeHintId = `cover-shape-hint-${useId()}`
/** Art of the other shape for this slot: offered, but named, since a letterboxed cover is a downgrade from a fitting one. */
const coverShapeHint = computed(() => {
  if (props.field.candidateCoverFit !== 'mismatch' || !props.field.candidateDisplay) return ''
  return isAudioCover.value
    ? t('book.detail.editMetadata.diff.coverShapeHint.portraitForAudio')
    : t('book.detail.editMetadata.diff.coverShapeHint.squareForBook')
})

const lightboxSrc = ref<string | null>(null)

function openCurrentCoverPreview() {
  if (props.field.isPicked) lightboxSrc.value = props.field.pickedDisplay || props.field.candidateDisplay
  else if (props.field.bookValue) lightboxSrc.value = props.field.bookValue
}

function openCandidateCoverPreview() {
  if (props.field.candidateDisplay) lightboxSrc.value = props.field.candidateDisplay
}

function handleCoverPreviewOpenChange(open: boolean) {
  if (!open) lightboxSrc.value = null
}
const isCurrentExpanded = ref(false)
const isCandidateExpanded = ref(false)

const pickedProviderLabel = computed(() => {
  if (!props.field.pickedProvider) return ''
  return props.field.providerValues.find((pv) => pv.provider === props.field.pickedProvider)?.label ?? props.field.pickedProvider
})

const CLAMPABLE_TEXT_FIELDS = new Set<DiffFieldKey>([
  'title',
  'subtitle',
  'authors',
  'description',
  'genres',
  'narrators',
  'comicPencillers',
  'comicInkers',
  'comicColorists',
  'comicLetterers',
  'comicCoverArtists',
  'comicCharacters',
  'comicTeams',
  'comicLocations',
  'comicStoryArcs',
])

const toggleLabel = computed(() =>
  props.field.isPicked
    ? t('book.detail.editMetadata.diff.keepCurrent', { field: t(props.field.labelKey) })
    : t('book.detail.editMetadata.diff.useNew', { field: t(props.field.labelKey) }),
)

const canClampCurrent = computed(
  () => CLAMPABLE_TEXT_FIELDS.has(props.field.key) && props.field.currentDisplay.length > 160 && props.field.key !== 'sourceUrl',
)
const canClampCandidate = computed(
  () => CLAMPABLE_TEXT_FIELDS.has(props.field.key) && props.field.candidateDisplay.length > 160 && props.field.key !== 'sourceUrl',
)
const currentTextClass = computed(() => (canClampCurrent.value && !isCurrentExpanded.value ? 'line-clamp-5' : ''))
const candidateTextClass = computed(() => (canClampCandidate.value && !isCandidateExpanded.value ? 'line-clamp-5' : ''))

function handleToggle() {
  emit('toggle', props.field.key)
}

function handlePickFromProvider(provider: MetadataProviderKey) {
  emit('pickFromProvider', props.field.key, provider)
}

function mergeGenres() {
  emit('update:genreWriteMode', 'merge')
}

function replaceGenres() {
  emit('update:genreWriteMode', 'replace')
}

function toggleCurrentExpanded() {
  isCurrentExpanded.value = !isCurrentExpanded.value
}

function toggleCandidateExpanded() {
  isCandidateExpanded.value = !isCandidateExpanded.value
}

watch(
  () => [props.field.key, props.field.currentDisplay, props.field.candidateDisplay],
  () => {
    isCurrentExpanded.value = false
    isCandidateExpanded.value = false
  },
)
</script>

<template>
  <!-- Cover row -->
  <div v-if="field.isCover" class="py-3.5 border-b border-border/40">
    <div class="mb-2.5 flex items-center gap-2">
      <p class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{{ t(field.labelKey) }}</p>
      <span v-if="field.isLocked" class="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-medium text-primary">
        {{ t('book.detail.editMetadata.diff.locked') }}
      </span>
    </div>
    <div class="grid grid-cols-[1fr_auto_1fr] gap-2 items-center">
      <!-- Current cover -->
      <div
        class="w-16 rounded-lg overflow-hidden bg-muted transition-all duration-300 shadow-sm ring-1 relative group"
        :class="field.isPicked ? 'ring-primary ring-2' : field.bookValue ? 'ring-border cursor-zoom-in' : 'ring-border opacity-50'"
        :style="{ aspectRatio: coverAspectRatio }"
        @click="openCurrentCoverPreview"
      >
        <template v-if="field.isPicked && field.pickedDisplay">
          <img
            :src="field.pickedDisplay"
            alt=""
            aria-hidden="true"
            class="absolute inset-0 w-full h-full object-cover scale-110 blur-md brightness-75"
          />
          <img
            :src="field.pickedDisplay"
            :alt="t('book.detail.editMetadata.diff.previewAlt')"
            class="relative w-full h-full object-contain"
            @error="hideOnError"
          />
        </template>
        <template v-else-if="field.bookValue">
          <img :src="field.bookValue" alt="" aria-hidden="true" class="absolute inset-0 w-full h-full object-cover scale-110 blur-md brightness-75" />
          <img
            :src="field.bookValue"
            :alt="t('book.detail.editMetadata.diff.currentCoverAlt')"
            class="relative w-full h-full object-contain"
            @error="hideOnError"
          />
        </template>
        <div v-else class="absolute inset-0">
          <BookCoverPlaceholder :title="bookSeed ?? null" :author-line="bookAuthorLine ?? null" :is-audio="isAudioCover" :seed="bookSeed ?? 'book'" />
        </div>
        <div
          v-if="field.isPicked || field.bookValue"
          class="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
        >
          <ZoomIn class="size-4 text-white" />
        </div>
        <!-- Picked-from-other indicator -->
        <div v-if="field.isPicked && !field.pickedFromActive && field.pickedProvider" class="absolute bottom-1 left-1 right-1">
          <span
            class="inline-flex items-center text-[8px] font-bold px-1 py-0.5 rounded w-full justify-center truncate"
            :style="providerBadgeStyle(field.pickedProvider)"
          >
            {{ pickedProviderLabel }}
          </span>
        </div>
      </div>

      <!-- Center: toggle + popover -->
      <div class="flex flex-col items-center gap-1 w-11">
        <button
          v-if="field.isCopyable && field.candidateDisplay"
          class="size-8 rounded-full flex items-center justify-center transition-all active:scale-90 shadow-sm"
          :class="
            field.isPicked
              ? 'bg-primary text-primary-foreground shadow-primary/30'
              : 'bg-card border border-border text-muted-foreground hover:border-primary/40 hover:text-primary hover:bg-primary/5'
          "
          :disabled="field.isLocked"
          :aria-label="toggleLabel"
          :aria-pressed="field.isPicked"
          :aria-describedby="coverShapeHint ? coverShapeHintId : undefined"
          @click="handleToggle"
        >
          <RotateCcw v-if="field.isPicked && field.pickedFromActive" class="size-3.5" />
          <Layers v-else-if="field.isPicked && !field.pickedFromActive" class="size-3.5" />
          <ArrowLeft v-else class="size-3.5" />
        </button>

        <Popover v-if="field.isCopyable && field.providerValues.length >= 2 && !field.isLocked">
          <PopoverTrigger as-child>
            <button
              class="size-5 rounded-full flex items-center justify-center transition-all hover:bg-muted text-muted-foreground hover:text-foreground"
              :title="t('book.detail.editMetadata.diff.pickCoverFromProvider')"
            >
              <Layers class="size-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent class="w-auto p-1.5" side="bottom" :side-offset="4">
            <div class="flex flex-col gap-1 min-w-48">
              <p class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 py-1">
                {{ t('book.detail.editMetadata.diff.pickCoverSource') }}
              </p>
              <button
                v-for="pv in field.providerValues"
                :key="pv.provider"
                class="flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors hover:bg-muted w-full"
                :class="pv.isPicked ? 'bg-primary/8 ring-1 ring-inset ring-primary/20' : ''"
                @click="handlePickFromProvider(pv.provider)"
              >
                <span class="relative shrink-0 w-8 rounded overflow-hidden bg-muted" :style="{ aspectRatio: coverAspectRatio }">
                  <img :src="pv.display" alt="" class="w-full h-full object-contain" @error="hideOnError" />
                </span>
                <span
                  class="inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded-md shrink-0"
                  :style="providerBadgeStyle(pv.provider)"
                >
                  {{ pv.label }}
                </span>
              </button>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <!-- New cover -->
      <div
        class="w-16 rounded-lg overflow-hidden bg-muted shadow-sm ring-1 transition-all duration-300 relative group"
        :class="
          field.candidateDisplay
            ? field.isPicked && field.pickedFromActive
              ? 'ring-primary ring-2 cursor-zoom-in'
              : 'ring-border cursor-zoom-in'
            : 'ring-border opacity-50'
        "
        :style="{ aspectRatio: coverAspectRatio }"
        @click="openCandidateCoverPreview"
      >
        <template v-if="field.candidateDisplay">
          <img
            :src="field.candidateDisplay"
            alt=""
            aria-hidden="true"
            class="absolute inset-0 w-full h-full object-cover scale-110 blur-md brightness-75"
          />
          <img
            :src="field.candidateDisplay"
            :alt="t('book.detail.editMetadata.diff.newCoverAlt')"
            class="relative w-full h-full object-contain"
            @error="hideOnError"
          />
        </template>
        <div v-else class="absolute inset-0">
          <BookCoverPlaceholder
            :title="candidateSeed ?? null"
            :author-line="candidateAuthorLine ?? null"
            :is-audio="isAudioCover"
            :seed="candidateSeed ?? 'candidate'"
          />
        </div>
        <div
          v-if="field.candidateDisplay"
          class="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
        >
          <ZoomIn class="size-4 text-white" />
        </div>
      </div>
    </div>
    <div v-if="coverShapeHint" class="grid grid-cols-[1fr_auto_1fr] gap-2">
      <p :id="coverShapeHintId" class="col-start-3 mt-1.5 min-w-0 text-[11px] leading-snug text-muted-foreground">{{ coverShapeHint }}</p>
    </div>
    <div v-if="$slots.coverResults" class="grid grid-cols-[1fr_auto_1fr] gap-2">
      <div class="col-start-3 min-w-0">
        <slot name="coverResults" />
      </div>
    </div>
  </div>

  <!-- Text row -->
  <div v-else class="py-2.5 border-b border-border/40">
    <div class="mb-1.5 flex items-center gap-2">
      <p class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{{ t(field.labelKey) }}</p>
      <span v-if="field.isLocked" class="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-medium text-primary">
        {{ t('book.detail.editMetadata.diff.locked') }}
      </span>
      <div
        v-if="field.key === 'genres'"
        class="ms-auto inline-flex rounded-md border border-input bg-muted p-0.5"
        role="radiogroup"
        :aria-label="t('book.detail.editMetadata.diff.genreWriteMode.label')"
      >
        <button
          type="button"
          role="radio"
          :aria-checked="genreWriteMode !== 'replace'"
          :disabled="field.isLocked"
          class="h-6 rounded px-2 text-[10px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50"
          :class="genreWriteMode !== 'replace' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
          @click="mergeGenres"
        >
          {{ t('book.detail.editMetadata.diff.genreWriteMode.merge') }}
        </button>
        <button
          type="button"
          role="radio"
          :aria-checked="genreWriteMode === 'replace'"
          :disabled="field.isLocked"
          class="h-6 rounded px-2 text-[10px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50"
          :class="genreWriteMode === 'replace' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
          @click="replaceGenres"
        >
          {{ t('book.detail.editMetadata.diff.genreWriteMode.replace') }}
        </button>
      </div>
    </div>

    <div class="flex flex-col gap-2 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:gap-1.5 sm:items-stretch">
      <!-- Current value -->
      <div
        class="min-w-0 rounded-lg px-3 py-2 transition-all duration-200"
        :class="!field.hasDiff ? 'bg-muted/30 opacity-50' : field.isPicked ? 'bg-muted/30 opacity-40' : 'bg-background ring-1 ring-border'"
      >
        <p class="text-[10px] font-medium text-muted-foreground mb-0.5 sm:hidden">{{ t('book.detail.editMetadata.diffPanel.current') }}</p>
        <p
          class="wrap-break-word leading-snug text-sm w-full"
          :class="[!field.currentDisplay ? 'text-muted-foreground italic' : 'text-foreground', currentTextClass]"
        >
          {{ field.currentDisplay || t('book.detail.editMetadata.diff.empty') }}
        </p>
        <button v-if="canClampCurrent" class="mt-1 text-[10px] font-medium text-primary hover:underline" @click="toggleCurrentExpanded">
          {{ isCurrentExpanded ? t('book.detail.editMetadata.diff.showLess') : t('book.detail.editMetadata.diff.showMore') }}
        </button>
        <!-- Badge when value is picked from a different provider than the active tab -->
        <span
          v-if="field.isPicked && !field.pickedFromActive && field.pickedProvider"
          class="inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded-md mt-1"
          :style="providerBadgeStyle(field.pickedProvider)"
        >
          {{ pickedProviderLabel }}
        </span>
      </div>

      <!-- Center: toggle + popover stacked -->
      <div class="flex items-center justify-center gap-0.5 w-11 sm:flex-col sm:justify-center">
        <button
          v-if="field.isCopyable && field.hasDiff"
          class="size-8 rounded-full flex items-center justify-center transition-all active:scale-90 shadow-sm shrink-0"
          :class="
            field.isPicked
              ? 'bg-primary text-primary-foreground shadow-primary/30'
              : 'bg-card border border-border text-muted-foreground hover:border-primary/40 hover:text-primary hover:bg-primary/5'
          "
          :disabled="field.isLocked"
          :aria-label="toggleLabel"
          :aria-pressed="field.isPicked"
          @click="handleToggle"
        >
          <RotateCcw v-if="field.isPicked && field.pickedFromActive" class="size-3.5" />
          <Layers v-else-if="field.isPicked && !field.pickedFromActive" class="size-3.5" />
          <ArrowLeft v-else class="size-3.5" />
        </button>
        <div v-else-if="field.isCopyable" class="size-8 flex items-center justify-center shrink-0">
          <CheckCircle2 class="size-3.5 text-muted-foreground" />
        </div>
        <div v-else class="size-8 shrink-0" />

        <Popover v-if="field.isCopyable && field.providerValues.length >= 2 && !field.isLocked">
          <PopoverTrigger as-child>
            <button
              class="size-5 rounded-full flex items-center justify-center transition-all hover:bg-muted text-muted-foreground hover:text-foreground shrink-0"
              :title="t('book.detail.editMetadata.diff.pickFromProvider')"
            >
              <Layers class="size-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent class="w-auto p-1.5" side="bottom" :side-offset="4" align="center">
            <div class="flex flex-col gap-0.5 min-w-44 max-w-72">
              <p class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 py-1">
                {{ t('book.detail.editMetadata.diff.pickSource') }}
              </p>
              <button
                v-for="pv in field.providerValues"
                :key="pv.provider"
                class="flex items-start gap-2 px-2 py-1.5 rounded-md text-left transition-colors hover:bg-muted w-full"
                :class="pv.isPicked ? 'bg-primary/8 ring-1 ring-inset ring-primary/20' : ''"
                @click="handlePickFromProvider(pv.provider)"
              >
                <span
                  class="inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded-md shrink-0 mt-0.5"
                  :style="providerBadgeStyle(pv.provider)"
                >
                  {{ pv.label }}
                </span>
                <span class="text-xs text-muted-foreground leading-snug line-clamp-2 min-w-0">{{ pv.display }}</span>
              </button>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <!-- New value -->
      <div
        class="min-w-0 rounded-lg px-3 py-2 transition-all duration-200"
        :class="
          !field.hasDiff ? 'bg-muted/30 opacity-50' : field.isPicked && field.pickedFromActive ? 'bg-primary/8 ring-1 ring-primary/20' : 'bg-muted/40'
        "
      >
        <p class="text-[10px] font-medium text-muted-foreground mb-0.5 sm:hidden">{{ t('book.detail.editMetadata.diffPanel.new') }}</p>
        <a
          v-if="field.key === 'sourceUrl' && field.candidateDisplay"
          :href="field.candidateDisplay"
          target="_blank"
          rel="noopener noreferrer"
          class="wrap-break-word leading-snug text-sm w-full text-primary hover:underline"
        >
          {{ field.candidateDisplay }}
        </a>
        <p
          v-else
          class="wrap-break-word leading-snug text-sm w-full"
          :class="[field.isPicked && field.pickedFromActive ? 'text-primary font-medium' : 'text-muted-foreground', candidateTextClass]"
        >
          {{ field.candidateDisplay }}
        </p>
        <button
          v-if="canClampCandidate && field.key !== 'sourceUrl'"
          class="mt-1 text-[10px] font-medium text-primary hover:underline"
          @click="toggleCandidateExpanded"
        >
          {{ isCandidateExpanded ? t('book.detail.editMetadata.diff.showLess') : t('book.detail.editMetadata.diff.showMore') }}
        </button>
      </div>
    </div>
  </div>

  <!-- A nested dialog, so a drawer or sheet around the diff treats it as its own child layer. -->
  <DialogRoot :open="lightboxSrc !== null" @update:open="handleCoverPreviewOpenChange">
    <DialogPortal>
      <DialogOverlay
        class="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none"
      />
      <DialogContent
        :aria-describedby="undefined"
        class="fixed left-1/2 top-1/2 z-[60] -translate-x-1/2 -translate-y-1/2 outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 motion-reduce:animate-none"
      >
        <DialogTitle class="sr-only">{{ t('book.detail.coverLightbox.title') }}</DialogTitle>
        <img
          v-if="lightboxSrc"
          :src="lightboxSrc"
          :alt="t('book.detail.editMetadata.diff.coverPreviewAlt')"
          class="max-h-[85vh] max-w-[85vw] rounded-lg shadow-2xl object-contain"
          @error="hideOnError"
        />
        <DialogClose
          class="absolute -top-3 -right-3 rounded-full border border-border bg-background p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          :aria-label="t('common.close')"
        >
          <X class="size-4" aria-hidden="true" />
        </DialogClose>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
