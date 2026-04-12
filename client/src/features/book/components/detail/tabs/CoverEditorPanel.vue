<script setup lang="ts">
import { computed, inject, ref, onUnmounted } from 'vue'
import { Image, ImagePlus, Link, Lock, LockOpen, Loader2, RotateCcw, Search, Upload, X } from 'lucide-vue-next'
import type { BookDetail } from '@projectx/types'
import { FORMAT_TO_GROUP } from '@projectx/types'
import { hideOnError } from '../../../lib/metadata-fetch'
import { useCoverEditor } from '../../../composables/useCoverEditor'
import { useCoverVersions } from '../../../composables/useCoverVersions'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { COVER_ASPECT_RATIO_KEY, DEFAULT_COVER_ASPECT_RATIO } from '../../../lib/cover-aspect-ratio'
import CoverSearchDrawer from './CoverSearchDrawer.vue'

const props = defineProps<{ book: BookDetail; locked?: boolean }>()
const emit = defineEmits<{ coverChanged: ['extracted' | 'custom' | null]; toggleLock: [] }>()

const bookIdRef = computed(() => props.book.id)
const { uploading, error, previewSrc, pendingFile, pendingUrl, selectFile, setUrl, clearPending, confirm, revert } = useCoverEditor(bookIdRef)

const { coverUrl, bumpVersion } = useCoverVersions()
const { hasPermission } = usePermissions()

const reExtractingCover = ref(false)

async function reExtractCover() {
  if (props.locked || reExtractingCover.value) return
  reExtractingCover.value = true
  try {
    await fetch(`/api/v1/books/${props.book.id}/re-extract-cover`, { method: 'POST' })
    bumpVersion(props.book.id)
    emit('coverChanged', 'extracted')
  } finally {
    reExtractingCover.value = false
  }
}

const mode = ref<'file' | 'url'>('file')
const urlInput = ref('')
const isSearchOpen = ref(false)

let debounceTimer: ReturnType<typeof setTimeout>

const activeSrc = computed(() => previewSrc.value ?? coverUrl(props.book.id, 'cover'))
const hasPending = computed(() => !!pendingFile.value || !!pendingUrl.value)
const primaryFile = computed(() => props.book.files.find((f) => f.role === 'primary') ?? props.book.files[0] ?? null)
const isPrimaryAudio = computed(() => primaryFile.value?.format != null && FORMAT_TO_GROUP[primaryFile.value.format] === 'audio')
const coverAspectRatio = inject(COVER_ASPECT_RATIO_KEY, ref(DEFAULT_COVER_ASPECT_RATIO))

function cancelPending() {
  clearPending()
  urlInput.value = ''
}

function onFileChange(e: Event) {
  if (props.locked) return
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) selectFile(file)
}

function onUrlInput() {
  if (props.locked) return
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => setUrl(urlInput.value.trim()), 400)
}

function switchMode(m: 'file' | 'url') {
  mode.value = m
  clearTimeout(debounceTimer)
  clearPending()
  urlInput.value = ''
}

function handleSearchSelect(url: string) {
  urlInput.value = url
  setUrl(url)
}

async function handleConfirm() {
  if (props.locked) return
  const ok = await confirm()
  if (ok) emit('coverChanged', 'custom')
}

async function handleRevert() {
  if (props.locked) return
  const result = await revert()
  if (result !== false) emit('coverChanged', result)
}

const lightboxOpen = ref(false)

defineExpose({ setUrl, hasPending, confirm })

onUnmounted(() => clearTimeout(debounceTimer))
</script>

<template>
  <div class="flex flex-row gap-5 md:gap-3 lg:flex-col">
    <!-- Cover image -->
    <div
      class="relative w-36 shrink-0 lg:w-full overflow-hidden rounded-xl bg-muted shadow-md cursor-zoom-in"
      :style="{ aspectRatio: coverAspectRatio }"
      @click="lightboxOpen = true"
    >
      <img :src="activeSrc" :alt="book.title ?? ''" class="w-full h-full object-contain" @error="hideOnError" />
      <button
        type="button"
        class="absolute bottom-2 right-2 flex items-center justify-center size-6 rounded-md bg-background/90 shadow-sm border border-input hover:bg-muted transition-colors"
        :title="props.locked ? 'Unlock cover' : 'Lock cover'"
        @click.stop="emit('toggleLock')"
      >
        <Lock v-if="props.locked" class="size-3.5 text-primary/70" />
        <LockOpen v-else class="size-3.5 text-muted-foreground" />
      </button>
    </div>

    <!-- Lightbox -->
    <Teleport to="body">
      <div v-if="lightboxOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" @click="lightboxOpen = false">
        <button
          class="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
          @click="lightboxOpen = false"
        >
          <X class="size-5" />
        </button>
        <img :src="activeSrc" :alt="book.title ?? ''" class="max-h-[90vh] max-w-[90vw] rounded-xl shadow-2xl object-contain" @click.stop />
      </div>
    </Teleport>

    <!-- Controls: beside thumbnail on mobile, stacked below on desktop -->
    <div class="flex-1 flex flex-col gap-3 lg:contents">
      <!-- Mode toggle -->
      <div class="flex gap-1 p-0.5 rounded-lg bg-muted">
        <button
          class="flex flex-1 items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          :class="mode === 'file' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
          :disabled="props.locked"
          @click="switchMode('file')"
        >
          <ImagePlus class="size-3.5" />
          File
        </button>
        <button
          class="flex flex-1 items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          :class="mode === 'url' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'"
          :disabled="props.locked"
          @click="switchMode('url')"
        >
          <Link class="size-3.5" />
          URL
        </button>
      </div>

      <!-- File input -->
      <div v-if="mode === 'file'">
        <label
          class="flex items-center gap-2 h-9 px-3 rounded-lg border border-dashed border-input bg-background text-xs text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
          :class="props.locked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'"
        >
          <Upload class="size-3.5 shrink-0" />
          <span class="truncate">{{ pendingFile ? pendingFile.name : 'Choose image...' }}</span>
          <input type="file" accept="image/*" class="hidden" :disabled="props.locked" @change="onFileChange" />
        </label>
      </div>

      <!-- URL input -->
      <div v-else class="flex flex-col gap-2">
        <input
          v-model="urlInput"
          class="w-full h-9 rounded-lg border border-input bg-background px-3 text-xs outline-none focus:ring-1 focus:ring-ring transition-shadow"
          :disabled="props.locked"
          @input="onUrlInput"
        />
      </div>

      <!-- Search Button -->
      <button
        class="flex items-center justify-center gap-2 w-full h-9 rounded-lg border border-input bg-background text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        :disabled="props.locked"
        @click="isSearchOpen = true"
      >
        <Search class="size-3.5" />
        Find cover online
      </button>

      <!-- Cover Search Drawer -->
      <Teleport to="body">
        <CoverSearchDrawer
          v-if="isSearchOpen"
          :initial-title="book.title ?? ''"
          :initial-author="book.authors?.[0]?.name ?? ''"
          :is-audiobook="isPrimaryAudio"
          @close="isSearchOpen = false"
          @select="handleSearchSelect"
        />
      </Teleport>

      <!-- Error -->
      <p v-if="error" class="text-xs text-destructive">{{ error }}</p>

      <!-- Actions -->
      <div class="flex flex-col gap-1.5">
        <button
          v-if="hasPending"
          class="w-full h-8 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          :disabled="uploading || props.locked"
          @click="handleConfirm"
        >
          {{ uploading ? 'Saving...' : 'Save cover' }}
        </button>
        <button
          v-if="hasPending"
          class="w-full h-8 rounded-lg border border-input bg-background text-xs hover:bg-muted transition-colors disabled:opacity-50"
          :disabled="uploading || props.locked"
          @click="cancelPending"
        >
          Cancel
        </button>
        <button
          v-if="book.coverSource === 'custom'"
          class="flex items-center justify-center gap-1.5 w-full h-8 rounded-lg border border-input bg-background text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          :disabled="uploading || props.locked"
          @click="handleRevert"
        >
          <RotateCcw class="size-3" />
          Revert to original
        </button>
        <button
          v-if="hasPermission('library_edit_metadata')"
          class="flex items-center justify-center gap-1.5 w-full h-8 rounded-lg border border-input bg-background text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          :disabled="reExtractingCover || props.locked"
          @click="reExtractCover"
        >
          <Loader2 v-if="reExtractingCover" class="size-3 animate-spin" />
          <Image v-else class="size-3" />
          Regenerate Cover
        </button>
      </div>
    </div>
  </div>
</template>
