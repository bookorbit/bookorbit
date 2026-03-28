<script setup lang="ts">
import { ref } from 'vue'
import { Plus, X } from 'lucide-vue-next'
import type { OrganizationMode } from '@projectx/types'
import { FORMAT_LABELS } from '../composables/useLibraryCreator'

const props = defineProps<{
  organizationMode: OrganizationMode
  allowedFormats: string[]
  excludePatterns: string[]
}>()

const emit = defineEmits<{
  'update:organizationMode': [value: OrganizationMode]
  'update:allowedFormats': [value: string[]]
  'update:excludePatterns': [value: string[]]
}>()

// ── Scan mode ─────────────────────────────────────────────────────────────────

function handleSelectMode(mode: OrganizationMode) {
  emit('update:organizationMode', mode)
}

// ── Allowed formats ──────────────────────────────────────────────────────────

const ALL_FORMATS = Object.keys(FORMAT_LABELS)

function toggleAllowedFormat(fmt: string) {
  const current = [...props.allowedFormats]
  const idx = current.indexOf(fmt)
  if (idx === -1) {
    current.push(fmt)
  } else {
    current.splice(idx, 1)
  }
  emit('update:allowedFormats', current)
}

function selectAllFormats() {
  emit('update:allowedFormats', [])
}

// ── Exclude patterns ─────────────────────────────────────────────────────────

const newPattern = ref('')

function addPattern() {
  const trimmed = newPattern.value.trim()
  if (!trimmed || props.excludePatterns.includes(trimmed)) return
  emit('update:excludePatterns', [...props.excludePatterns, trimmed])
  newPattern.value = ''
}

function removePattern(i: number) {
  const updated = [...props.excludePatterns]
  updated.splice(i, 1)
  emit('update:excludePatterns', updated)
}

function onPatternKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    addPattern()
  }
}
</script>

<template>
  <div class="px-6 py-6 space-y-8">
    <!-- Scan mode -->
    <div>
      <p class="text-[11px] font-semibold uppercase tracking-widest text-foreground/80 mb-3">Scan mode</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          class="text-left rounded-lg border p-4 transition-colors"
          :class="organizationMode === 'auto' ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border bg-card hover:border-primary/40'"
          @click="handleSelectMode('auto')"
        >
          <div class="flex items-center gap-2 mb-1.5">
            <span
              class="w-3.5 h-3.5 rounded-full border-2 shrink-0 flex items-center justify-center"
              :class="organizationMode === 'auto' ? 'border-primary' : 'border-muted-foreground/40'"
            >
              <span v-if="organizationMode === 'auto'" class="w-1.5 h-1.5 rounded-full bg-primary" />
            </span>
            <span class="text-sm font-semibold text-foreground">Folder as Book</span>
            <span class="ml-auto text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded">Recommended</span>
          </div>
          <p class="text-xs text-muted-foreground leading-relaxed">
            All files in a folder are grouped into one book. Works well when you keep multiple formats, like EPUB and MOBI, together.
          </p>
        </button>

        <button
          class="text-left rounded-lg border p-4 transition-colors"
          :class="
            organizationMode === 'book_per_file' ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border bg-card hover:border-primary/40'
          "
          @click="handleSelectMode('book_per_file')"
        >
          <div class="flex items-center gap-2 mb-1.5">
            <span
              class="w-3.5 h-3.5 rounded-full border-2 shrink-0 flex items-center justify-center"
              :class="organizationMode === 'book_per_file' ? 'border-primary' : 'border-muted-foreground/40'"
            >
              <span v-if="organizationMode === 'book_per_file'" class="w-1.5 h-1.5 rounded-full bg-primary" />
            </span>
            <span class="text-sm font-semibold text-foreground">File as Book</span>
          </div>
          <p class="text-xs text-muted-foreground leading-relaxed">
            Treats every file as an individual book. Best suited for libraries with one format per title. Avoid if your audiobooks span multiple
            files.
          </p>
        </button>
      </div>
      <p v-if="organizationMode === 'book_per_file'" class="mt-2 text-xs text-amber-600 dark:text-amber-400">
        Folder structure will not be used for metadata. Changes take effect on the next full scan.
      </p>
    </div>

    <!-- Filtering group -->
    <div>
      <!-- Allowed formats -->
      <div class="mb-8">
        <div class="flex items-center justify-between mb-1">
          <p class="text-[11px] font-semibold uppercase tracking-widest text-foreground/80">Allowed formats</p>
          <button
            v-if="allowedFormats.length > 0"
            class="text-xs text-muted-foreground hover:text-foreground transition-colors"
            @click="selectAllFormats"
          >
            Allow all
          </button>
        </div>
        <p class="text-xs text-muted-foreground mb-3">
          {{ allowedFormats.length === 0 ? 'All formats are allowed.' : 'Only the selected formats will be imported.' }}
        </p>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="fmt in ALL_FORMATS"
            :key="fmt"
            class="px-2.75 py-1 rounded-full text-[11px] font-medium border transition-colors"
            :class="
              allowedFormats.length === 0 || allowedFormats.includes(fmt)
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
            "
            @click="toggleAllowedFormat(fmt)"
          >
            {{ fmt.toUpperCase() }}
          </button>
        </div>
        <p v-if="allowedFormats.length > 0" class="mt-2 text-xs text-amber-600 dark:text-amber-400">
          Books in other formats already in the library will be marked as missing on the next scan.
        </p>
      </div>

      <!-- Exclude patterns -->
      <div>
        <p class="text-[11px] font-semibold uppercase tracking-widest text-foreground/80 mb-1">Exclude patterns</p>
        <p class="text-xs text-muted-foreground mb-3">
          Glob patterns to skip during scanning (e.g. <code class="font-mono bg-muted px-1 rounded">**/samples/**</code>).
        </p>
        <div class="flex gap-2 mb-2">
          <input
            v-model="newPattern"
            type="text"
            placeholder="**/node_modules/**"
            class="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-ring"
            @keydown="onPatternKeydown"
          />
          <button
            class="flex items-center gap-1.5 px-3 py-2 rounded-md border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
            @click="addPattern"
          >
            <Plus :size="13" />
            Add
          </button>
        </div>
        <div class="min-h-[40px] rounded-md border border-border bg-muted/30 p-2 flex flex-wrap gap-1.5 overflow-y-auto" style="max-height: 80px">
          <span v-if="excludePatterns.length === 0" class="text-xs text-muted-foreground/50 self-center px-1"> No patterns added. </span>
          <span
            v-for="(pattern, i) in excludePatterns"
            :key="pattern"
            class="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-background border border-border text-xs font-mono text-foreground"
          >
            {{ pattern }}
            <button class="text-muted-foreground hover:text-destructive transition-colors" @click="removePattern(i)">
              <X :size="11" />
            </button>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
