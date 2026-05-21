<script setup lang="ts">
const props = defineProps<{
  fileRenameEnabled: boolean
  fileWriteEnabled: boolean
  fileWriteWriteCover: boolean
  fileWriteEpubEnabled: boolean
  fileWriteEpubMaxFileSizeMb: number
  fileWritePdfEnabled: boolean
  fileWritePdfMaxFileSizeMb: number
  fileWriteCbxEnabled: boolean
  fileWriteCbxMaxFileSizeMb: number
}>()

const emit = defineEmits<{
  'update:fileRenameEnabled': [value: boolean]
  'update:fileWriteEnabled': [value: boolean]
  'update:fileWriteWriteCover': [value: boolean]
  'update:fileWriteEpubEnabled': [value: boolean]
  'update:fileWriteEpubMaxFileSizeMb': [value: number]
  'update:fileWritePdfEnabled': [value: boolean]
  'update:fileWritePdfMaxFileSizeMb': [value: number]
  'update:fileWriteCbxEnabled': [value: boolean]
  'update:fileWriteCbxMaxFileSizeMb': [value: number]
}>()

function handleFileRenameToggle() {
  emit('update:fileRenameEnabled', !props.fileRenameEnabled)
}

function handleFileWriteToggle() {
  emit('update:fileWriteEnabled', !props.fileWriteEnabled)
}

function handleWriteCoverToggle() {
  emit('update:fileWriteWriteCover', !props.fileWriteWriteCover)
}

function handleEpubToggle() {
  emit('update:fileWriteEpubEnabled', !props.fileWriteEpubEnabled)
}

function handlePdfToggle() {
  emit('update:fileWritePdfEnabled', !props.fileWritePdfEnabled)
}

function handleCbxToggle() {
  emit('update:fileWriteCbxEnabled', !props.fileWriteCbxEnabled)
}

function onMaxSizeInput(field: 'epub' | 'pdf' | 'cbx', e: Event) {
  const val = parseInt((e.target as HTMLInputElement).value, 10)
  if (!isNaN(val) && val >= 1) {
    if (field === 'epub') emit('update:fileWriteEpubMaxFileSizeMb', val)
    else if (field === 'pdf') emit('update:fileWritePdfMaxFileSizeMb', val)
    else emit('update:fileWriteCbxMaxFileSizeMb', val)
  }
}

function onEpubMaxSizeInput(e: Event) {
  onMaxSizeInput('epub', e)
}

function onPdfMaxSizeInput(e: Event) {
  onMaxSizeInput('pdf', e)
}

function onCbxMaxSizeInput(e: Event) {
  onMaxSizeInput('cbx', e)
}
</script>

<template>
  <div class="px-6 py-6 space-y-6">
    <div>
      <div class="flex items-center justify-between mb-1">
        <p class="text-[11px] font-semibold uppercase tracking-widest text-foreground/80">Rename files on metadata update</p>
        <button
          class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-none"
          :class="fileRenameEnabled ? 'bg-primary' : 'bg-muted-foreground/30'"
          role="switch"
          :aria-checked="fileRenameEnabled"
          @click="handleFileRenameToggle"
        >
          <span
            class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
            :class="fileRenameEnabled ? 'translate-x-4' : 'translate-x-0'"
          />
        </button>
      </div>
      <p class="text-xs text-muted-foreground">
        When enabled, updating title, author, series, or year will rename the physical file using the library naming pattern.
      </p>
    </div>

    <div>
      <div class="flex items-center justify-between mb-1">
        <p class="text-[11px] font-semibold uppercase tracking-widest text-foreground/80">Write metadata to files</p>
        <button
          class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-none"
          :class="fileWriteEnabled ? 'bg-primary' : 'bg-muted-foreground/30'"
          role="switch"
          :aria-checked="fileWriteEnabled"
          @click="handleFileWriteToggle"
        >
          <span
            class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
            :class="fileWriteEnabled ? 'translate-x-4' : 'translate-x-0'"
          />
        </button>
      </div>
      <p class="text-xs text-muted-foreground">When enabled, saving metadata will also write changes back into the physical file on disk.</p>
    </div>

    <template v-if="fileWriteEnabled">
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm font-medium text-foreground">Include cover image</p>
          <p class="text-xs text-muted-foreground mt-0.5">Writes the stored cover back into the file (EPUB only).</p>
        </div>
        <button
          class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-none"
          :class="fileWriteWriteCover ? 'bg-primary' : 'bg-muted-foreground/30'"
          role="switch"
          :aria-checked="fileWriteWriteCover"
          @click="handleWriteCoverToggle"
        >
          <span
            class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
            :class="fileWriteWriteCover ? 'translate-x-4' : 'translate-x-0'"
          />
        </button>
      </div>

      <div class="border-t border-border" />

      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-foreground">EPUB</p>
            <p class="text-xs text-muted-foreground mt-0.5">Writes metadata into the OPF file inside the EPUB archive.</p>
          </div>
          <button
            class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-none"
            :class="fileWriteEpubEnabled ? 'bg-primary' : 'bg-muted-foreground/30'"
            role="switch"
            :aria-checked="fileWriteEpubEnabled"
            @click="handleEpubToggle"
          >
            <span
              class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
              :class="fileWriteEpubEnabled ? 'translate-x-4' : 'translate-x-0'"
            />
          </button>
        </div>
        <div v-if="fileWriteEpubEnabled" class="flex items-center justify-between gap-4">
          <p class="text-xs text-muted-foreground">Max file size (MB)</p>
          <input
            type="number"
            :value="fileWriteEpubMaxFileSizeMb"
            min="1"
            max="10000"
            class="w-24 rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            @input="onEpubMaxSizeInput"
          />
        </div>
      </div>

      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-foreground">PDF</p>
            <p class="text-xs text-muted-foreground mt-0.5">Embeds metadata into PDF Info dictionary and XMP stream.</p>
          </div>
          <button
            class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-none"
            :class="fileWritePdfEnabled ? 'bg-primary' : 'bg-muted-foreground/30'"
            role="switch"
            :aria-checked="fileWritePdfEnabled"
            @click="handlePdfToggle"
          >
            <span
              class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
              :class="fileWritePdfEnabled ? 'translate-x-4' : 'translate-x-0'"
            />
          </button>
        </div>
        <div v-if="fileWritePdfEnabled" class="flex items-center justify-between gap-4">
          <p class="text-xs text-muted-foreground">Max file size (MB)</p>
          <input
            type="number"
            :value="fileWritePdfMaxFileSizeMb"
            min="1"
            max="10000"
            class="w-24 rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            @input="onPdfMaxSizeInput"
          />
        </div>
      </div>

      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-foreground">Comic archives (CBX)</p>
            <p class="text-xs text-muted-foreground mt-0.5">Writes ComicInfo.xml into CBZ and CB7 archives.</p>
          </div>
          <button
            class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-none"
            :class="fileWriteCbxEnabled ? 'bg-primary' : 'bg-muted-foreground/30'"
            role="switch"
            :aria-checked="fileWriteCbxEnabled"
            @click="handleCbxToggle"
          >
            <span
              class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
              :class="fileWriteCbxEnabled ? 'translate-x-4' : 'translate-x-0'"
            />
          </button>
        </div>
        <div v-if="fileWriteCbxEnabled" class="flex items-center justify-between gap-4">
          <p class="text-xs text-muted-foreground">Max file size (MB)</p>
          <input
            type="number"
            :value="fileWriteCbxMaxFileSizeMb"
            min="1"
            max="10000"
            class="w-24 rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            @input="onCbxMaxSizeInput"
          />
        </div>
      </div>
    </template>
  </div>
</template>
