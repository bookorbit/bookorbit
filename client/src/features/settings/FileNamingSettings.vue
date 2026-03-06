<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Check, ChevronDown, ChevronUp, FileText, Loader2, RotateCcw, Save } from 'lucide-vue-next'
import { DEFAULT_DOWNLOAD_PATTERN, DEFAULT_UPLOAD_PATTERN, PATTERN_TOKENS } from '@projectx/types'
import { useFileNamingPattern } from './composables/useFileNamingPattern'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const {
  globalPattern,
  globalError,
  downloadPattern,
  downloadError,
  libraries,
  loadingGlobal,
  savingGlobal,
  loadingDownload,
  savingDownload,
  savingLibraryId,
  fetchGlobalPattern,
  fetchDownloadPattern,
  fetchLibraries,
  onGlobalPatternInput,
  onDownloadPatternInput,
  saveGlobalPattern,
  saveDownloadPattern,
  saveLibraryPattern,
  clearLibraryPattern,
  getEffectivePreview,
  previewDownloadName,
  previewPath,
} = useFileNamingPattern()

const referenceOpen = ref(true)

const MODIFIERS = [
  { key: ':first', description: 'First value only' },
  { key: ':sort', description: 'Last, First format' },
  { key: ':initial', description: 'First letter only' },
  { key: ':upper', description: 'UPPERCASE' },
  { key: ':lower', description: 'lowercase' },
]

const EXAMPLES = [
  {
    pattern: '{authors}/<{series}/><{seriesIndex}. >{title}',
    cases: [
      { label: 'with series', result: 'William Gibson/Sprawl/01. Neuromancer.epub' },
      { label: 'without', result: 'William Gibson/Neuromancer.epub' },
    ],
  },
  {
    pattern: '<{series}|Standalone>/{title}',
    cases: [
      { label: 'with series', result: 'Sprawl/Neuromancer.epub' },
      { label: 'without', result: 'Standalone/Neuromancer.epub' },
    ],
  },
]

onMounted(async () => {
  await Promise.all([fetchGlobalPattern(), fetchDownloadPattern(), fetchLibraries()])
})
</script>

<template>
  <div class="space-y-8">
    <!-- Page header -->
    <div>
      <h2 class="settings-title">File Naming</h2>
      <p class="settings-subtitle">
        Control naming patterns for uploads and downloads using the same placeholder syntax.
      </p>
    </div>

    <!-- Upload global default -->
    <div>
      <p class="settings-group-label">Upload Pattern</p>
      <div class="border border-border rounded-lg bg-card px-5 py-5 space-y-4">
        <p class="text-xs text-muted-foreground leading-relaxed">
          Applied to all libraries unless overridden. Leave blank to use the built-in default layout.
        </p>

        <div class="space-y-1.5">
          <div class="flex gap-2">
            <input
              :value="globalPattern"
              type="text"
              :placeholder="DEFAULT_UPLOAD_PATTERN"
              class="flex-1 h-8 rounded-md border border-input bg-background px-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
              :class="globalError ? 'border-destructive focus:ring-destructive' : ''"
              :disabled="loadingGlobal"
              @input="onGlobalPatternInput(($event.target as HTMLInputElement).value)"
            />
            <button
              class="flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-background text-sm text-foreground hover:bg-muted transition-colors disabled:opacity-50"
              :disabled="savingGlobal || !!globalError || loadingGlobal"
              @click="saveGlobalPattern"
            >
              <Loader2 v-if="savingGlobal" :size="13" class="animate-spin" />
              <Save v-else :size="13" />
              Save
            </button>
          </div>
          <p v-if="globalError" class="text-xs text-destructive">{{ globalError }}</p>
          <p class="text-xs text-muted-foreground font-mono">
            Preview: <span class="text-foreground">{{ previewPath(globalPattern) }}</span>
          </p>
        </div>
      </div>
    </div>

    <!-- Download global default -->
    <div>
      <p class="settings-group-label">Download Pattern</p>
      <div class="border border-border rounded-lg bg-card px-5 py-5 space-y-4">
        <p class="text-xs text-muted-foreground leading-relaxed">
          Controls suggested filenames for single-file downloads and files inside export ZIPs.
        </p>

        <div class="space-y-1.5">
          <div class="flex gap-2">
            <input
              :value="downloadPattern"
              type="text"
              :placeholder="DEFAULT_DOWNLOAD_PATTERN"
              class="flex-1 h-8 rounded-md border border-input bg-background px-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
              :class="downloadError ? 'border-destructive focus:ring-destructive' : ''"
              :disabled="loadingDownload"
              @input="onDownloadPatternInput(($event.target as HTMLInputElement).value)"
            />
            <button
              class="flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-background text-sm text-foreground hover:bg-muted transition-colors disabled:opacity-50"
              :disabled="savingDownload || !!downloadError || loadingDownload"
              @click="saveDownloadPattern"
            >
              <Loader2 v-if="savingDownload" :size="13" class="animate-spin" />
              <Save v-else :size="13" />
              Save
            </button>
          </div>
          <p v-if="downloadError" class="text-xs text-destructive">{{ downloadError }}</p>
          <p class="text-xs text-muted-foreground font-mono">
            Preview: <span class="text-foreground">{{ previewDownloadName(downloadPattern) }}</span>
          </p>
        </div>
      </div>
    </div>

    <!-- Per-library overrides -->
    <div>
      <p class="settings-group-label">Library Overrides</p>
      <div class="border border-border rounded-lg bg-card divide-y divide-border">
        <div v-if="libraries.length === 0" class="px-5 py-8 text-center text-sm text-muted-foreground">No libraries configured.</div>

        <div v-for="lib in libraries" :key="lib.id" class="px-5 py-4 space-y-3">
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-2 min-w-0">
              <FileText :size="14" class="text-muted-foreground shrink-0" />
              <span class="settings-label truncate">{{ lib.name }}</span>
              <span v-if="lib.fileNamingPattern" class="shrink-0 text-xs font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                custom
              </span>
              <span v-else class="shrink-0 text-xs font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground"> using default </span>
            </div>
            <Tooltip>
              <TooltipTrigger as-child>
                <button
                  v-if="lib.fileNamingPattern"
                  class="shrink-0 flex items-center gap-1 h-7 px-2 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                  :disabled="savingLibraryId === lib.id"
                  @click="clearLibraryPattern(lib)"
                >
                  <RotateCcw :size="11" />
                  Reset
                </button>
              </TooltipTrigger>
              <TooltipContent>Clear override</TooltipContent>
            </Tooltip>
          </div>

          <div class="space-y-1.5">
            <div class="flex gap-2">
              <input
                :value="lib.fileNamingPattern ?? ''"
                type="text"
                :placeholder="globalPattern || DEFAULT_UPLOAD_PATTERN"
                class="flex-1 h-8 rounded-md border border-input bg-background px-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
                @input="lib.fileNamingPattern = ($event.target as HTMLInputElement).value || null"
              />
              <button
                class="flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-background text-sm text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                :disabled="savingLibraryId === lib.id"
                @click="saveLibraryPattern(lib)"
              >
                <Loader2 v-if="savingLibraryId === lib.id" :size="13" class="animate-spin" />
                <Check v-else :size="13" />
                Save
              </button>
            </div>
            <p class="text-xs text-muted-foreground font-mono">
              Preview: <span class="text-foreground">{{ getEffectivePreview(lib) }}</span>
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- Placeholder reference (collapsible) -->
    <div class="border border-border rounded-lg bg-card overflow-hidden">
      <button
        class="w-full flex items-center justify-between px-5 py-4 hover:bg-muted/50 transition-colors"
        @click="referenceOpen = !referenceOpen"
      >
        <span class="text-sm font-medium text-foreground">Placeholder Reference</span>
        <ChevronDown v-if="!referenceOpen" :size="15" class="text-muted-foreground" />
        <ChevronUp v-else :size="15" class="text-muted-foreground" />
      </button>

      <div v-if="referenceOpen" class="border-t border-border divide-y divide-border/60">
        <!-- Tokens -->
        <div class="px-5 py-4 space-y-2.5">
          <p class="text-xs font-medium text-foreground">Available tokens</p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-y-1.5 gap-x-6">
            <div v-for="t in PATTERN_TOKENS" :key="t.token" class="flex items-center gap-2">
              <code class="shrink-0 text-xs font-mono bg-primary/10 text-primary px-1.5 py-0.5 rounded">{{ '{' + t.token + '}' }}</code>
              <span class="text-xs text-muted-foreground">{{ t.description }}</span>
            </div>
          </div>
        </div>

        <!-- Modifiers -->
        <div class="px-5 py-4 space-y-2.5">
          <p class="text-xs font-medium text-foreground">Modifiers</p>
          <p class="text-xs text-muted-foreground">
            Append <code class="bg-muted px-1 py-0.5 rounded font-mono text-foreground">:modifier</code> inside a token. Example:
            <code class="bg-muted px-1 py-0.5 rounded font-mono text-foreground">{'{authors:sort}'}</code>
          </p>
          <div class="flex flex-wrap gap-2">
            <div
              v-for="mod in MODIFIERS"
              :key="mod.key"
              class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-muted/50 border border-border/60"
            >
              <code class="text-xs font-mono text-foreground">{{ mod.key }}</code>
              <span class="text-[11px] text-muted-foreground">{{ mod.description }}</span>
            </div>
          </div>
        </div>

        <!-- Optional blocks -->
        <div class="px-5 py-4 space-y-2.5">
          <p class="text-xs font-medium text-foreground">Optional blocks</p>
          <p class="text-xs text-muted-foreground">
            Wrap in <code class="bg-muted px-1 py-0.5 rounded font-mono text-foreground">&lt;...&gt;</code> to skip a segment when its tokens are
            empty. Use <code class="bg-muted px-1 py-0.5 rounded font-mono text-foreground">|fallback</code> to substitute a value instead.
          </p>
          <div class="space-y-2">
            <div v-for="ex in EXAMPLES" :key="ex.pattern" class="rounded-md border border-border/60 overflow-hidden">
              <div class="px-3 py-2 bg-muted/50 border-b border-border/60">
                <code class="text-xs font-mono text-foreground">{{ ex.pattern }}</code>
              </div>
              <div class="px-3 py-2.5 space-y-1.5">
                <div v-for="c in ex.cases" :key="c.label" class="flex items-baseline gap-3">
                  <span class="text-[11px] text-muted-foreground shrink-0 w-16">{{ c.label }}</span>
                  <code class="text-xs font-mono text-foreground/80 break-all">{{ c.result }}</code>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Folder-only mode -->
        <div class="px-5 py-4">
          <p class="text-xs font-medium text-foreground mb-1.5">Folder-only mode</p>
          <p class="text-xs text-muted-foreground">
            End the pattern with <code class="bg-muted px-1 py-0.5 rounded font-mono text-foreground">/</code> to specify a folder only - the
            original filename is preserved inside it. This affects upload destinations and ZIP export paths.
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
