<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { AlertTriangle, FileWarning, Loader2, UploadCloud, X } from '@lucide/vue'
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { toast } from 'vue-sonner'
import { CUSTOM_ICON_MAX_UPLOAD_FILES, CUSTOM_ICON_NAME_MAX_LENGTH } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { useCustomIcons } from '@/features/custom-icons/composables/useCustomIcons'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean]; uploaded: [] }>()

const { stageIcons, uploadStagedIcons } = useCustomIcons()

interface StagedEntry {
  id: string
  file: File
  filename: string
  ok: boolean
  error?: string
  name: string
  previewUrl?: string
  sanitizedSvg?: string
  duplicateOfSlug?: string
  duplicateOfName?: string
  skip: boolean
}

const entries = ref<StagedEntry[]>([])
const staging = ref(false)
const uploading = ref(false)
const dragActive = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)
let entrySeq = 0

function entryError(entry: StagedEntry): string | null {
  if (!entry.ok) return entry.error ?? 'Invalid SVG'
  if (entry.skip) return null
  if (!entry.name.trim()) return 'Name is required'
  return null
}

const uploadableCount = computed(() => entries.value.filter((entry) => entry.ok && !entry.skip).length)
const hasBlockingErrors = computed(() => entries.value.some((entry) => entry.ok && !entry.skip && entryError(entry) !== null))
const canConfirm = computed(() => uploadableCount.value > 0 && !hasBlockingErrors.value && !uploading.value && !staging.value)

watch(
  () => props.open,
  (open) => {
    if (!open) resetEntries()
  },
)

function resetEntries() {
  for (const entry of entries.value) if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl)
  entries.value = []
  dragActive.value = false
}

function handleOpenChange(open: boolean) {
  emit('update:open', open)
}

function closeDialog() {
  handleOpenChange(false)
}

function openFilePicker() {
  fileInputRef.value?.click()
}

async function handleFileInput(event: Event) {
  const input = event.target as HTMLInputElement
  await addFiles(Array.from(input.files ?? []))
  input.value = ''
}

function handleDragEnter() {
  dragActive.value = true
}

function handleDragLeave() {
  dragActive.value = false
}

async function handleDrop(event: DragEvent) {
  dragActive.value = false
  await addFiles(Array.from(event.dataTransfer?.files ?? []))
}

async function addFiles(files: File[]) {
  const svgFiles = files.filter((file) => file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg'))
  if (svgFiles.length === 0) {
    if (files.length > 0) toast.error('Only SVG files are supported')
    return
  }
  const room = CUSTOM_ICON_MAX_UPLOAD_FILES - entries.value.length
  if (room <= 0) {
    toast.error(`You can stage at most ${CUSTOM_ICON_MAX_UPLOAD_FILES} icons at once`)
    return
  }
  const accepted = svgFiles.slice(0, room)
  if (svgFiles.length > room) toast.warning(`Only ${room} more icon${room === 1 ? '' : 's'} can be staged`)

  staging.value = true
  try {
    const { items } = await stageIcons(accepted)
    items.forEach((item, index) => {
      const file = accepted[index]
      if (!file) return
      entries.value.push({
        id: `e${entrySeq++}`,
        file,
        filename: item.filename,
        ok: item.ok,
        error: item.error,
        name: item.suggestedName ?? '',
        previewUrl: item.sanitizedSvg ? URL.createObjectURL(new Blob([item.sanitizedSvg], { type: 'image/svg+xml' })) : undefined,
        sanitizedSvg: item.sanitizedSvg,
        duplicateOfSlug: item.duplicateOfSlug,
        duplicateOfName: item.duplicateOfName,
        skip: Boolean(item.duplicateOfSlug),
      })
    })
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Failed to read SVG files')
  } finally {
    staging.value = false
  }
}

function removeEntry(entry: StagedEntry) {
  if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl)
  entries.value = entries.value.filter((e) => e.id !== entry.id)
}

function toggleSkip(entry: StagedEntry) {
  entry.skip = !entry.skip
}

async function confirmUpload() {
  if (!canConfirm.value) return
  const toUpload = entries.value.filter((entry) => entry.ok && !entry.skip)
  uploading.value = true
  try {
    const { items } = await uploadStagedIcons(toUpload.map((entry) => ({ file: entry.file, name: entry.name.trim() })))
    const created = items.filter((item) => item.status === 'created').length
    const failed = items.length - created
    if (created > 0) emit('uploaded')
    if (created > 0 && failed === 0) {
      toast.success(`Uploaded ${created} icon${created === 1 ? '' : 's'}`)
      closeDialog()
    } else if (created > 0) {
      toast.warning(`Uploaded ${created}, ${failed} failed`)
      applyServerErrors(items)
    } else {
      toast.error('No icons uploaded')
      applyServerErrors(items)
    }
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Failed to upload icons')
  } finally {
    uploading.value = false
  }
}

function applyServerErrors(items: { filename: string; status: string; error?: string }[]) {
  const failedByName = new Map(items.filter((item) => item.status === 'failed').map((item) => [item.filename, item.error]))
  const createdNames = new Set(items.filter((item) => item.status === 'created').map((item) => item.filename))
  entries.value = entries.value.filter((entry) => !(entry.ok && !entry.skip && createdNames.has(entry.file.name)))
  for (const entry of entries.value) {
    if (failedByName.has(entry.file.name)) {
      entry.ok = false
      entry.error = failedByName.get(entry.file.name) ?? 'Upload failed'
    }
  }
}
</script>

<template>
  <DialogRoot :open="open" @update:open="handleOpenChange">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
      <DialogContent
        class="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl outline-none"
        @escape-key-down="closeDialog"
      >
        <div class="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <DialogTitle class="text-sm font-semibold text-foreground">Upload custom icons</DialogTitle>
            <DialogDescription class="text-xs text-muted-foreground">Review names before adding them to your library.</DialogDescription>
          </div>
          <DialogClose
            class="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X :size="15" />
          </DialogClose>
        </div>

        <div class="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <input ref="fileInputRef" type="file" accept="image/svg+xml,.svg" multiple class="hidden" @change="handleFileInput" />

          <button
            type="button"
            class="flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center transition-colors"
            :class="dragActive ? 'border-primary bg-primary/5' : 'border-border bg-muted/30 hover:border-primary/40'"
            @click="openFilePicker"
            @dragenter.prevent="handleDragEnter"
            @dragover.prevent="handleDragEnter"
            @dragleave.prevent="handleDragLeave"
            @drop.prevent="handleDrop"
          >
            <span class="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Loader2 v-if="staging" :size="18" class="animate-spin" />
              <UploadCloud v-else :size="18" />
            </span>
            <span class="text-sm font-medium text-foreground">{{ staging ? 'Reading files...' : 'Drop SVG files or click to browse' }}</span>
            <span class="text-xs text-muted-foreground">Up to {{ CUSTOM_ICON_MAX_UPLOAD_FILES }} files, 128 KB each</span>
          </button>

          <div v-if="entries.length > 0" class="space-y-2">
            <div
              v-for="entry in entries"
              :key="entry.id"
              class="rounded-lg border p-3"
              :class="
                entry.skip
                  ? 'border-border bg-muted/30 opacity-70'
                  : entryError(entry)
                    ? 'border-destructive/40 bg-destructive/5'
                    : 'border-border bg-background'
              "
            >
              <div class="flex items-start gap-3">
                <div
                  class="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/50 text-foreground"
                >
                  <div v-if="entry.sanitizedSvg" v-html="entry.sanitizedSvg" class="flex size-full items-center justify-center [&_svg]:size-7"></div>
                  <FileWarning v-else :size="18" class="text-destructive" />
                </div>

                <div class="min-w-0 flex-1">
                  <div class="mb-1 flex items-center gap-2">
                    <p class="truncate text-xs text-muted-foreground" :title="entry.filename">{{ entry.filename }}</p>
                    <button
                      type="button"
                      class="ml-auto flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      @click="removeEntry(entry)"
                    >
                      <X :size="13" />
                    </button>
                  </div>

                  <template v-if="entry.ok">
                    <div class="grid max-w-md gap-2">
                      <input
                        v-model="entry.name"
                        :disabled="entry.skip"
                        :maxlength="CUSTOM_ICON_NAME_MAX_LENGTH"
                        placeholder="Name"
                        class="h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
                      />
                    </div>

                    <p v-if="entryError(entry)" class="mt-1 flex items-center gap-1 text-xs text-destructive">
                      <AlertTriangle :size="12" />
                      {{ entryError(entry) }}
                    </p>

                    <div v-if="entry.duplicateOfSlug" class="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                      <span
                        class="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 font-medium text-amber-600 dark:text-amber-400"
                      >
                        <AlertTriangle :size="11" />
                        Identical to "{{ entry.duplicateOfName ?? entry.duplicateOfSlug }}"
                      </span>
                      <button
                        type="button"
                        class="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                        @click="toggleSkip(entry)"
                      >
                        {{ entry.skip ? 'Upload anyway' : 'Skip this one' }}
                      </button>
                    </div>
                  </template>

                  <p v-else class="flex items-center gap-1 text-xs text-destructive">
                    <AlertTriangle :size="12" />
                    {{ entry.error ?? 'Invalid SVG file' }}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
          <p class="text-xs text-muted-foreground">
            <span v-if="uploadableCount > 0">{{ uploadableCount }} ready to upload</span>
            <span v-else>No icons staged yet</span>
          </p>
          <div class="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" class="h-9" @click="closeDialog">Cancel</Button>
            <Button type="button" size="sm" class="h-9" :disabled="!canConfirm" @click="confirmUpload">
              <Loader2 v-if="uploading" :size="14" class="animate-spin" />
              {{ uploading ? 'Uploading...' : uploadableCount > 0 ? `Upload ${uploadableCount}` : 'Upload' }}
            </Button>
          </div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
