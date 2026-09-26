<script setup lang="ts">
import { computed, inject, nextTick, onUnmounted, reactive, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Image, ImagePlus, Link, Loader2, Lock, LockOpen, Maximize2, RotateCcw, Search, Upload } from '@lucide/vue'
import type { BookDetail, BookMetadataLockField, CoverMedium } from '@bookorbit/types'
import { hideOnError } from '../../../lib/metadata-fetch'
import { useCoverEditor } from '../../../composables/useCoverEditor'
import { useCoverVersions } from '../../../composables/useCoverVersions'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { COVER_ASPECT_RATIO_KEY, DEFAULT_COVER_ASPECT_RATIO } from '../../../lib/cover-aspect-ratio'
import { coverFieldMedium, coverLockField, coverTileState, editorTiles } from '../../../lib/cover-slots'
import { nextRovingIndex } from '@/lib/roving-index'
import BookCoverLightbox from '@/features/book/components/BookCoverLightbox.vue'
import BookCoverPlaceholder from '@/features/book/components/BookCoverPlaceholder.vue'
import CoverSearchDrawer from './CoverSearchDrawer.vue'

type TileKey = CoverMedium | 'none'
type CoverLockField = ReturnType<typeof coverLockField>

const props = defineProps<{ book: BookDetail; lockedFields: readonly BookMetadataLockField[]; disabled?: boolean }>()
const emit = defineEmits<{ coverChanged: [medium: CoverMedium | null]; toggleLock: [field: CoverLockField] }>()

const { t } = useI18n()
const { coverUrl } = useCoverVersions()
const { hasPermission } = usePermissions()
const coverAspectRatio = inject(COVER_ASPECT_RATIO_KEY, ref(DEFAULT_COVER_ASPECT_RATIO))

const bookIdRef = computed(() => props.book.id)
// One editor per slot, so a pending image on one tile survives selecting the other.
const editors = {
  ebook: reactive(useCoverEditor(bookIdRef, 'ebook')),
  audio: reactive(useCoverEditor(bookIdRef, 'audio')),
  none: reactive(useCoverEditor(bookIdRef, null)),
}
const tileUi = reactive<Record<TileKey, { mode: 'file' | 'url'; urlInput: string }>>({
  ebook: { mode: 'file', urlInput: '' },
  audio: { mode: 'file', urlInput: '' },
  none: { mode: 'file', urlInput: '' },
})

function tileKey(medium: CoverMedium | null): TileKey {
  return medium ?? 'none'
}

function mediumOf(key: TileKey): CoverMedium | null {
  return key === 'none' ? null : key
}

const tileKeys = computed<TileKey[]>(() => editorTiles(props.book).map(tileKey))
const isMultiSlot = computed(() => tileKeys.value.length > 1)
const selectedKey = ref<TileKey>(tileKeys.value[0] ?? 'none')

watch(tileKeys, (keys) => {
  if (!keys.includes(selectedKey.value)) selectedKey.value = keys[0] ?? 'none'
})

function clearAllPending() {
  clearTimeout(debounceTimer)
  for (const key of Object.keys(editors) as TileKey[]) {
    editors[key].clearPending()
    tileUi[key] = { mode: 'file', urlInput: '' }
  }
}

watch(
  () => props.book.id,
  () => {
    clearAllPending()
    selectedKey.value = tileKeys.value[0] ?? 'none'
  },
)

const coverSeed = computed(() => props.book.title ?? props.book.folderPath.split('/').pop() ?? String(props.book.id))
const authorLine = computed(() => props.book.authors.map((a) => a.name).join(', ') || null)

const tiles = computed(() =>
  tileKeys.value.map((key) => {
    const medium = mediumOf(key)
    const editor = editors[key]
    const state = coverTileState(props.book, medium, coverAspectRatio.value)
    const lockField = coverLockField(medium)
    const locked = props.lockedFields.includes(lockField)
    return {
      key,
      medium,
      lockField,
      locked,
      hasImage: state.hasImage || Boolean(editor.previewSrc),
      src: editor.previewSrc ?? coverUrl(props.book.id, 'cover', state.version, medium ?? undefined),
      source: state.source,
      label: medium === 'audio' ? t('book.detail.coverEditor.slotAudio') : t('book.detail.coverEditor.slotEbook'),
      name: medium === 'audio' ? t('book.detail.coverEditor.slotAudioName') : t('book.detail.coverEditor.slotEbookName'),
      lockLabel: lockLabel(medium, locked),
      viewLargerLabel: viewLargerLabel(medium),
    }
  }),
)

function lockLabel(medium: CoverMedium | null, locked: boolean): string {
  if (!isMultiSlot.value) return locked ? t('book.detail.coverEditor.unlockCover') : t('book.detail.coverEditor.lockCover')
  if (medium === 'audio') return locked ? t('book.detail.coverEditor.unlockAudioCover') : t('book.detail.coverEditor.lockAudioCover')
  return locked ? t('book.detail.coverEditor.unlockEbookCover') : t('book.detail.coverEditor.lockEbookCover')
}

function viewLargerLabel(medium: CoverMedium | null): string {
  if (!isMultiSlot.value) return t('book.detail.coverEditor.viewLarger')
  return medium === 'audio' ? t('book.detail.coverEditor.viewLargerAudio') : t('book.detail.coverEditor.viewLargerEbook')
}

const selectedTile = computed(() => tiles.value.find((tile) => tile.key === selectedKey.value) ?? tiles.value[0]!)
const activeEditor = computed(() => editors[selectedTile.value.key])
const activeUi = computed(() => tileUi[selectedTile.value.key])
const controlsDisabled = computed(() => Boolean(props.disabled || selectedTile.value.locked))
const hasActivePending = computed(() => Boolean(activeEditor.value.pendingFile || activeEditor.value.pendingUrl))
const editingCaption = computed(() =>
  selectedTile.value.medium === 'audio' ? t('book.detail.coverEditor.editingAudio') : t('book.detail.coverEditor.editingEbook'),
)
const captionId = `cover-editor-caption-${useId()}`

const pendingKeys = computed(() => tileKeys.value.filter((key) => Boolean(editors[key].pendingFile || editors[key].pendingUrl)))
const hasPending = computed(() => pendingKeys.value.length > 0)
const pendingMedia = computed(() => pendingKeys.value.map(mediumOf))
const busy = computed(() => tileKeys.value.some((key) => editors[key].uploading || editors[key].regenerating))

const tileGroup = ref<HTMLElement | null>(null)

function selectTile(key: TileKey) {
  selectedKey.value = key
}

function handleTileKeydown(event: KeyboardEvent) {
  const index = tileKeys.value.indexOf(selectedKey.value)
  const next = nextRovingIndex(event.key, index, tileKeys.value.length)
  if (next === null) return
  event.preventDefault()
  const key = tileKeys.value[next]!
  selectedKey.value = key
  void nextTick(() => tileGroup.value?.querySelector<HTMLButtonElement>(`[data-cover-tile="${key}"]`)?.focus())
}

function handleToggleLock(field: CoverLockField) {
  if (props.disabled) return
  emit('toggleLock', field)
}

const lightboxOpen = ref(false)
const lightboxMedium = ref<CoverMedium | null>(null)
const lightboxPreviews = computed(() => ({ ebook: editors.ebook.previewSrc, audio: editors.audio.previewSrc }))

function openLightbox(key: TileKey) {
  lightboxMedium.value = mediumOf(key)
  lightboxOpen.value = true
}

function handleLightboxOpenChange(open: boolean) {
  lightboxOpen.value = open
}

let debounceTimer: ReturnType<typeof setTimeout> | undefined

function cancelPending() {
  activeEditor.value.clearPending()
  activeUi.value.urlInput = ''
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (controlsDisabled.value || !file) return
  activeEditor.value.selectFile(file)
}

function applyPendingUrl(key: TileKey) {
  if (props.disabled || tiles.value.find((tile) => tile.key === key)?.locked) return
  editors[key].setUrl(tileUi[key].urlInput.trim())
}

function onUrlInput() {
  if (controlsDisabled.value) return
  clearTimeout(debounceTimer)
  const key = selectedKey.value
  debounceTimer = setTimeout(() => applyPendingUrl(key), 400)
}

function switchMode(mode: 'file' | 'url') {
  if (controlsDisabled.value) return
  clearTimeout(debounceTimer)
  activeUi.value.mode = mode
  cancelPending()
}

function handleSelectFileMode() {
  switchMode('file')
}

function handleSelectUrlMode() {
  switchMode('url')
}

const isSearchOpen = ref(false)

function handleOpenSearch() {
  if (controlsDisabled.value) return
  isSearchOpen.value = true
}

function handleSearchOpenChange(open: boolean) {
  isSearchOpen.value = open && !controlsDisabled.value
}

function handleSearchSelect(url: string) {
  if (controlsDisabled.value) return
  activeUi.value.urlInput = url
  activeEditor.value.setUrl(url)
}

async function confirmTile(key: TileKey): Promise<boolean> {
  const ok = await editors[key].confirm()
  if (ok) {
    tileUi[key].urlInput = ''
    emit('coverChanged', mediumOf(key))
  }
  return ok
}

async function handleConfirm() {
  if (controlsDisabled.value || activeEditor.value.uploading) return
  await confirmTile(selectedKey.value)
}

async function handleRevert() {
  if (controlsDisabled.value) return
  const key = selectedKey.value
  const result = await editors[key].revert()
  if (result !== false) emit('coverChanged', mediumOf(key))
}

async function handleRegenerate() {
  if (controlsDisabled.value || activeEditor.value.regenerating) return
  const key = selectedKey.value
  if (await editors[key].regenerate()) emit('coverChanged', mediumOf(key))
}

/**
 * Saves the pending tiles, all of them by default. It stops at the first failure and selects that
 * tile, so its error is the one on screen.
 */
async function confirmPending(media: readonly (CoverMedium | null)[] = pendingMedia.value): Promise<boolean> {
  if (props.disabled) return false
  const keys = media.map(tileKey).filter((key) => pendingKeys.value.includes(key))
  if (keys.some((key) => editors[key].uploading)) return false
  for (const key of keys) {
    if (!(await confirmTile(key))) {
      selectedKey.value = key
      return false
    }
  }
  return true
}

/**
 * Stages a fetched cover on a tile. A medium the book has picks its tile; otherwise the cover goes to
 * the ebook slot, or the only slot a book without an ebook has.
 */
function setPendingUrl(url: string, medium?: CoverMedium) {
  const key = tileKey(medium && props.book.coverMedia.includes(medium) ? medium : coverFieldMedium(props.book))
  const tile = tiles.value.find((candidate) => candidate.key === key)
  if (props.disabled || !tile || tile.locked) return
  selectedKey.value = key
  editors[key].setUrl(url)
}

defineExpose({ setUrl: setPendingUrl, hasPending, pendingMedia, busy, confirm: confirmPending, reset: clearAllPending })

onUnmounted(() => clearTimeout(debounceTimer))
</script>

<template>
  <div class="@container/cover-editor">
    <div class="flex min-w-0 flex-col gap-3" :class="isMultiSlot ? '' : '@min-[21rem]/cover-editor:flex-row @min-[21rem]/cover-editor:gap-5'">
      <!-- Two slots: a radio group of tiles. Each tile's lock and zoom sit beside its radio, not inside it. -->
      <div
        v-if="isMultiSlot"
        ref="tileGroup"
        role="radiogroup"
        :aria-label="t('book.detail.coverEditor.slotsLabel')"
        class="flex flex-wrap items-end justify-center gap-3"
      >
        <div v-for="tile in tiles" :key="tile.key" class="flex flex-col items-center gap-1.5">
          <div
            class="relative h-36 overflow-hidden rounded-lg bg-muted shadow-md ring-2 ring-offset-2 ring-offset-background transition-shadow"
            :class="[tile.medium === 'audio' ? 'aspect-square' : 'aspect-[2/3]', tile.key === selectedKey ? 'ring-primary' : 'ring-transparent']"
          >
            <button
              type="button"
              role="radio"
              :data-cover-tile="tile.key"
              :aria-checked="tile.key === selectedKey"
              :tabindex="tile.key === selectedKey ? 0 : -1"
              :aria-label="tile.name"
              :disabled="props.disabled"
              class="relative block h-full w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              @click="selectTile(tile.key)"
              @keydown="handleTileKeydown"
            >
              <img v-if="tile.hasImage" :src="tile.src" alt="" class="h-full w-full object-contain" @error="hideOnError" />
              <BookCoverPlaceholder v-else :title="book.title" :author-line="authorLine" :is-audio="tile.medium === 'audio'" :seed="coverSeed" />
            </button>
            <button
              v-if="tile.hasImage"
              type="button"
              class="absolute bottom-2 left-2 flex size-7 items-center justify-center rounded-md border border-input bg-background/90 text-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              :title="tile.viewLargerLabel"
              :aria-label="tile.viewLargerLabel"
              :disabled="props.disabled"
              @click="openLightbox(tile.key)"
            >
              <Maximize2 class="size-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="absolute right-2 bottom-2 flex size-7 items-center justify-center rounded-md border shadow-sm backdrop-blur-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              :class="
                tile.locked
                  ? 'border-primary/40 bg-primary/25 text-primary hover:bg-primary/35'
                  : 'border-input bg-background/90 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:text-foreground'
              "
              :title="tile.lockLabel"
              :aria-label="tile.lockLabel"
              :disabled="props.disabled"
              @click="handleToggleLock(tile.lockField)"
            >
              <Lock v-if="tile.locked" class="size-4" aria-hidden="true" />
              <LockOpen v-else class="size-4" aria-hidden="true" />
            </button>
          </div>
          <span class="text-xs" :class="tile.key === selectedKey ? 'font-semibold text-primary' : 'text-muted-foreground'" aria-hidden="true">
            {{ tile.label }}
          </span>
        </div>
      </div>

      <!-- One slot: the cover itself, which opens the lightbox. -->
      <template v-else>
        <div
          v-for="tile in tiles"
          :key="tile.key"
          class="relative w-full shrink-0 overflow-hidden rounded-lg bg-muted shadow-md @min-[21rem]/cover-editor:w-36"
          :style="{ aspectRatio: coverAspectRatio }"
        >
          <button
            v-if="tile.hasImage"
            type="button"
            class="block h-full w-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            :aria-label="tile.viewLargerLabel"
            :disabled="props.disabled"
            @click="openLightbox(tile.key)"
          >
            <img :src="tile.src" :alt="book.title ?? ''" class="h-full w-full object-contain" @error="hideOnError" />
          </button>
          <BookCoverPlaceholder v-else :title="book.title" :author-line="authorLine" :is-audio="tile.medium === 'audio'" :seed="coverSeed" />
          <button
            type="button"
            class="absolute right-2 bottom-2 flex size-7 items-center justify-center rounded-md border shadow-sm backdrop-blur-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :class="
              tile.locked
                ? 'border-primary/40 bg-primary/25 text-primary hover:bg-primary/35'
                : 'border-input bg-background/90 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:text-foreground'
            "
            :title="tile.lockLabel"
            :aria-label="tile.lockLabel"
            :disabled="props.disabled"
            @click="handleToggleLock(tile.lockField)"
          >
            <Lock v-if="tile.locked" class="size-4" aria-hidden="true" />
            <LockOpen v-else class="size-4" aria-hidden="true" />
          </button>
        </div>
      </template>

      <BookCoverLightbox
        :open="lightboxOpen"
        :book="book"
        :medium="lightboxMedium"
        :previews="lightboxPreviews"
        @update:open="handleLightboxOpenChange"
      />

      <!-- Controls act on the selected tile, and the caption names it for everyone. -->
      <div
        class="flex min-w-0 flex-1 flex-col gap-3"
        :role="isMultiSlot ? 'group' : undefined"
        :aria-labelledby="isMultiSlot ? captionId : undefined"
      >
        <p v-if="isMultiSlot" :id="captionId" class="text-xs font-medium text-muted-foreground">{{ editingCaption }}</p>

        <div class="flex gap-1 p-0.5 rounded-lg bg-muted" role="group" :aria-label="t('book.detail.coverEditor.sourceMode')">
          <button
            type="button"
            class="flex flex-1 items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :class="activeUi.mode === 'file' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
            :aria-pressed="activeUi.mode === 'file'"
            :disabled="controlsDisabled"
            @click="handleSelectFileMode"
          >
            <ImagePlus class="size-3.5" aria-hidden="true" />
            {{ t('book.detail.coverEditor.fileTab') }}
          </button>
          <button
            type="button"
            class="flex flex-1 items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :class="activeUi.mode === 'url' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
            :aria-pressed="activeUi.mode === 'url'"
            :disabled="controlsDisabled"
            @click="handleSelectUrlMode"
          >
            <Link class="size-3.5" aria-hidden="true" />
            {{ t('book.detail.coverEditor.urlTab') }}
          </button>
        </div>

        <!-- The input stays in the tab order; only its box is hidden, so the label is what shows focus. -->
        <label
          v-if="activeUi.mode === 'file'"
          class="relative flex items-center gap-2 h-9 px-3 rounded-lg border border-dashed border-input bg-background text-xs text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors focus-within:ring-2 focus-within:ring-ring"
          :class="controlsDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'"
        >
          <Upload class="size-3.5 shrink-0" aria-hidden="true" />
          <span class="truncate">{{ activeEditor.pendingFile ? activeEditor.pendingFile.name : t('book.detail.coverEditor.chooseImage') }}</span>
          <input type="file" accept="image/*" class="sr-only" :disabled="controlsDisabled" @change="onFileChange" />
        </label>

        <input
          v-else
          v-model="activeUi.urlInput"
          inputmode="url"
          :aria-label="t('book.detail.coverEditor.urlLabel')"
          class="w-full h-9 rounded-lg border border-input bg-background px-3 text-xs outline-none focus:ring-1 focus:ring-ring transition-shadow"
          :disabled="controlsDisabled"
          @input="onUrlInput"
        />

        <button
          type="button"
          class="flex items-center justify-center gap-2 w-full h-9 rounded-lg border border-input bg-background text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="controlsDisabled"
          @click="handleOpenSearch"
        >
          <Search class="size-3.5" aria-hidden="true" />
          {{ t('book.detail.coverEditor.findCoverOnline') }}
        </button>

        <CoverSearchDrawer
          :open="isSearchOpen"
          :initial-title="book.title ?? ''"
          :initial-author="book.authors?.[0]?.name ?? ''"
          :is-audiobook="selectedTile.medium === 'audio'"
          @update:open="handleSearchOpenChange"
          @select="handleSearchSelect"
        />

        <p v-if="activeEditor.error" role="alert" class="text-xs text-destructive">{{ activeEditor.error }}</p>

        <div class="flex flex-col gap-1.5">
          <button
            v-if="hasActivePending"
            type="button"
            class="w-full h-8 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            :disabled="activeEditor.uploading || controlsDisabled"
            @click="handleConfirm"
          >
            {{ activeEditor.uploading ? t('book.detail.coverEditor.saving') : t('book.detail.coverEditor.saveCover') }}
          </button>
          <button
            v-if="hasActivePending"
            type="button"
            class="w-full h-8 rounded-lg border border-input bg-background text-xs hover:bg-muted transition-colors disabled:opacity-50"
            :disabled="activeEditor.uploading || controlsDisabled"
            @click="cancelPending"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            v-if="selectedTile.source === 'custom'"
            type="button"
            class="flex items-center justify-center gap-1.5 w-full h-8 rounded-lg border border-input bg-background text-xs text-muted-foreground hover:text-foreground focus-visible:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
            :disabled="activeEditor.uploading || controlsDisabled"
            @click="handleRevert"
          >
            <RotateCcw class="size-3" aria-hidden="true" />
            {{ t('book.detail.coverEditor.revertToOriginal') }}
          </button>
          <button
            v-if="hasPermission('library_edit_metadata')"
            type="button"
            class="flex items-center justify-center gap-1.5 w-full h-8 rounded-lg border border-input bg-background text-xs text-muted-foreground hover:text-foreground focus-visible:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
            :disabled="activeEditor.regenerating || controlsDisabled"
            @click="handleRegenerate"
          >
            <Loader2 v-if="activeEditor.regenerating" class="size-3 animate-spin" aria-hidden="true" />
            <Image v-else class="size-3" aria-hidden="true" />
            {{ t('book.detail.coverEditor.regenerateCover') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
