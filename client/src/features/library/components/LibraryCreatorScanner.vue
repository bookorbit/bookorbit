<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Lock, Plus, X } from '@lucide/vue'
import type { OrganizationMode } from '@bookorbit/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { FORMAT_LABELS } from '../composables/useLibraryCreator'

const { t } = useI18n()

const props = defineProps<{
  organizationMode: OrganizationMode
  organizationModeLocked?: boolean
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
  if (props.organizationModeLocked) return
  emit('update:organizationMode', mode)
}

function handleSelectFolderMode() {
  handleSelectMode('book_per_folder')
}

function handleSelectFileMode() {
  handleSelectMode('book_per_file')
}

// ── Allowed formats ──────────────────────────────────────────────────────────

const ALL_FORMATS = Object.keys(FORMAT_LABELS)

function toggleAllowedFormat(fmt: string) {
  const current = [...props.allowedFormats]
  const idx = current.indexOf(fmt)
  if (idx === -1) {
    current.push(fmt)
  } else {
    if (current.length === 1) return
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
      <div class="flex items-center gap-2 mb-3">
        <p class="text-[11px] font-semibold uppercase tracking-widest text-foreground/80">{{ t('library.creator.scanner.scanMode.title') }}</p>
        <Tooltip v-if="organizationModeLocked">
          <TooltipTrigger as-child>
            <span
              class="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border text-muted-foreground cursor-help"
              :aria-label="t('library.creator.scanner.scanMode.lockedAria')"
            >
              <Lock :size="11" />
            </span>
          </TooltipTrigger>
          <TooltipContent class="max-w-72 text-xs leading-relaxed">
            {{ t('library.creator.scanner.scanMode.lockTooltip') }}
          </TooltipContent>
        </Tooltip>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          type="button"
          class="text-left rounded-lg border p-4 transition-colors"
          :class="[
            organizationMode === 'book_per_folder'
              ? 'border-primary bg-primary/5 ring-1 ring-primary'
              : 'border-border bg-card hover:border-primary/40',
            organizationModeLocked ? 'cursor-not-allowed opacity-75' : '',
          ]"
          :disabled="organizationModeLocked"
          @click="handleSelectFolderMode"
        >
          <div class="flex items-center gap-2 mb-1.5">
            <span
              class="w-3.5 h-3.5 rounded-full border-2 shrink-0 flex items-center justify-center"
              :class="organizationMode === 'book_per_folder' ? 'border-primary' : 'border-muted-foreground/40'"
            >
              <span v-if="organizationMode === 'book_per_folder'" class="w-1.5 h-1.5 rounded-full bg-primary" />
            </span>
            <span class="text-sm font-semibold text-foreground">{{ t('library.creator.scanner.scanMode.folderAsBook.title') }}</span>
          </div>
          <p class="text-xs text-muted-foreground leading-relaxed">
            {{ t('library.creator.scanner.scanMode.folderAsBook.hint') }}
          </p>
        </button>

        <button
          type="button"
          class="text-left rounded-lg border p-4 transition-colors"
          :class="[
            organizationMode === 'book_per_file'
              ? 'border-primary bg-primary/5 ring-1 ring-primary'
              : 'border-border bg-card hover:border-primary/40',
            organizationModeLocked ? 'cursor-not-allowed opacity-75' : '',
          ]"
          :disabled="organizationModeLocked"
          @click="handleSelectFileMode"
        >
          <div class="flex items-center gap-2 mb-1.5">
            <span
              class="w-3.5 h-3.5 rounded-full border-2 shrink-0 flex items-center justify-center"
              :class="organizationMode === 'book_per_file' ? 'border-primary' : 'border-muted-foreground/40'"
            >
              <span v-if="organizationMode === 'book_per_file'" class="w-1.5 h-1.5 rounded-full bg-primary" />
            </span>
            <span class="text-sm font-semibold text-foreground">{{ t('library.creator.scanner.scanMode.fileAsBook.title') }}</span>
          </div>
          <p class="text-xs text-muted-foreground leading-relaxed">
            {{ t('library.creator.scanner.scanMode.fileAsBook.hint') }}
          </p>
        </button>
      </div>
    </div>

    <!-- Filtering group -->
    <div>
      <!-- Allowed formats -->
      <div class="mb-8">
        <div class="flex items-center justify-between mb-1">
          <p class="text-[11px] font-semibold uppercase tracking-widest text-foreground/80">
            {{ t('library.creator.scanner.allowedFormats.title') }}
          </p>
          <button
            v-if="allowedFormats.length > 0"
            type="button"
            class="text-xs text-muted-foreground hover:text-foreground transition-colors"
            @click="selectAllFormats"
          >
            {{ t('library.creator.scanner.allowedFormats.allowAll') }}
          </button>
        </div>
        <p class="text-xs text-muted-foreground mb-3">
          {{
            allowedFormats.length === 0
              ? t('library.creator.scanner.allowedFormats.allAllowed')
              : t('library.creator.scanner.allowedFormats.onlySelected')
          }}
        </p>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="fmt in ALL_FORMATS"
            :key="fmt"
            type="button"
            class="px-2.75 py-1 rounded-full text-[11px] font-medium border transition-colors"
            :class="
              allowedFormats.length === 0 || allowedFormats.includes(fmt)
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
            "
            :aria-pressed="allowedFormats.length === 0 || allowedFormats.includes(fmt)"
            @click="toggleAllowedFormat(fmt)"
          >
            {{ fmt.toUpperCase() }}
          </button>
        </div>
        <p v-if="allowedFormats.length > 0" class="mt-2 text-xs font-medium text-foreground">
          Books in other formats already in the library will be marked as missing on the next scan.
        </p>
      </div>

      <!-- Exclude patterns -->
      <div>
        <p class="text-[11px] font-semibold uppercase tracking-widest text-foreground/80 mb-1">
          {{ t('library.creator.scanner.excludePatterns.title') }}
        </p>
        <p class="text-xs text-muted-foreground mb-3">
          {{ t('library.creator.scanner.excludePatterns.hintBefore') }} <code class="font-mono bg-muted px-1 rounded">**/samples/**</code
          >{{ t('library.creator.scanner.excludePatterns.hintAfter') }}
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
            type="button"
            class="flex items-center gap-1.5 px-3 py-2 rounded-md border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
            :disabled="!newPattern.trim()"
            @click="addPattern"
          >
            <Plus :size="13" />
            {{ t('library.creator.scanner.excludePatterns.add') }}
          </button>
        </div>
        <div class="min-h-[40px] rounded-md border border-border bg-muted/30 p-2 flex flex-wrap gap-1.5 overflow-y-auto" style="max-height: 80px">
          <span v-if="excludePatterns.length === 0" class="text-xs text-muted-foreground/50 self-center px-1">
            {{ t('library.creator.scanner.excludePatterns.empty') }}
          </span>
          <span
            v-for="(pattern, i) in excludePatterns"
            :key="pattern"
            class="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-background border border-border text-xs font-mono text-foreground"
          >
            {{ pattern }}
            <button
              type="button"
              class="text-muted-foreground hover:text-destructive transition-colors"
              :aria-label="`Remove exclude pattern ${pattern}`"
              @click="removePattern(i)"
            >
              <X :size="11" />
            </button>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
