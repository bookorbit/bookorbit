<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Check, ChevronDown, ChevronUp, FileText, Loader2, RotateCcw, Save } from 'lucide-vue-next'
import { DEFAULT_UPLOAD_PATTERN, PATTERN_TOKENS } from '@projectx/types'
import { useFileNamingPattern } from './composables/useFileNamingPattern'

const {
  globalPattern,
  globalError,
  libraries,
  loadingGlobal,
  savingGlobal,
  savingLibraryId,
  fetchGlobalPattern,
  fetchLibraries,
  onGlobalPatternInput,
  saveGlobalPattern,
  saveLibraryPattern,
  clearLibraryPattern,
  getEffectivePreview,
  previewPath,
} = useFileNamingPattern()

const referenceOpen = ref(true)

const EXAMPLE_PATTERN_CONDITIONAL = '{authors}/<{series}/><{seriesIndex}. >{title}'
const EXAMPLE_PATTERN_ELSE = '<{series}|Standalone>/{title}'

onMounted(async () => {
  await Promise.all([fetchGlobalPattern(), fetchLibraries()])
})
</script>

<template>
  <div class="px-5 py-6 sm:px-10 sm:py-8 max-w-3xl mx-auto space-y-8">
    <!-- Page header -->
    <div>
      <h2 class="font-serif font-semibold text-foreground text-2xl tracking-tight">File Naming</h2>
      <p class="mt-1 text-sm text-muted-foreground">
        Control how uploaded files are named and organized on disk. Patterns apply when a file is uploaded.
      </p>
    </div>

    <!-- Global default -->
    <div>
      <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Default Pattern</p>
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

    <!-- Per-library overrides -->
    <div>
      <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Library Overrides</p>
      <div class="border border-border rounded-lg bg-card divide-y divide-border">
        <div v-if="libraries.length === 0" class="px-5 py-8 text-center text-sm text-muted-foreground">No libraries configured.</div>

        <div v-for="lib in libraries" :key="lib.id" class="px-5 py-4 space-y-3">
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-2 min-w-0">
              <FileText :size="14" class="text-muted-foreground shrink-0" />
              <span class="text-sm font-medium text-foreground truncate">{{ lib.name }}</span>
              <span v-if="lib.fileNamingPattern" class="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                custom
              </span>
              <span v-else class="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground"> using default </span>
            </div>
            <button
              v-if="lib.fileNamingPattern"
              class="shrink-0 flex items-center gap-1 h-7 px-2 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
              title="Clear override"
              :disabled="savingLibraryId === lib.id"
              @click="clearLibraryPattern(lib)"
            >
              <RotateCcw :size="11" />
              Reset
            </button>
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
        class="w-full flex items-center justify-between px-5 py-4 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
        @click="referenceOpen = !referenceOpen"
      >
        <span>Placeholder Reference</span>
        <ChevronDown v-if="!referenceOpen" :size="15" class="text-muted-foreground" />
        <ChevronUp v-else :size="15" class="text-muted-foreground" />
      </button>

      <div v-if="referenceOpen" class="px-5 pb-5 space-y-5 border-t border-border">
        <!-- Tokens -->
        <div class="pt-4 space-y-2">
          <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Available tokens</p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            <div v-for="t in PATTERN_TOKENS" :key="t.token" class="flex items-center gap-2">
              <code class="text-xs bg-muted px-1.5 py-0.5 rounded text-foreground shrink-0">{{ '{' + t.token + '}' }}</code>
              <span class="text-xs text-muted-foreground">{{ t.description }}</span>
            </div>
          </div>
        </div>

        <!-- Modifiers -->
        <div class="space-y-2">
          <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Modifiers</p>
          <p class="text-xs text-muted-foreground">
            Append <code class="bg-muted px-1 rounded">:modifier</code> inside a token. Example:
            <code class="bg-muted px-1 rounded">{'{authors:sort}'}</code>
          </p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            <div class="flex items-center gap-2">
              <code class="text-xs bg-muted px-1.5 py-0.5 rounded">:first</code><span class="text-xs text-muted-foreground">First value only</span>
            </div>
            <div class="flex items-center gap-2">
              <code class="text-xs bg-muted px-1.5 py-0.5 rounded">:sort</code><span class="text-xs text-muted-foreground">Last, First format</span>
            </div>
            <div class="flex items-center gap-2">
              <code class="text-xs bg-muted px-1.5 py-0.5 rounded">:initial</code><span class="text-xs text-muted-foreground">First letter only</span>
            </div>
            <div class="flex items-center gap-2">
              <code class="text-xs bg-muted px-1.5 py-0.5 rounded">:upper</code><span class="text-xs text-muted-foreground">UPPERCASE</span>
            </div>
            <div class="flex items-center gap-2">
              <code class="text-xs bg-muted px-1.5 py-0.5 rounded">:lower</code><span class="text-xs text-muted-foreground">lowercase</span>
            </div>
          </div>
        </div>

        <!-- Optional blocks -->
        <div class="space-y-2">
          <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Optional blocks</p>
          <p class="text-xs text-muted-foreground leading-relaxed">
            Wrap in <code class="bg-muted px-1 rounded">&lt;...&gt;</code> to omit a segment when all its tokens are empty. Use
            <code class="bg-muted px-1 rounded">|</code> for a fallback: <code class="bg-muted px-1 rounded">&lt;primary|fallback&gt;</code>.
          </p>
          <div class="rounded-md bg-muted/50 px-4 py-3 space-y-2 text-xs font-mono">
            <div>
              <span class="text-muted-foreground">Pattern: </span><span>{{ EXAMPLE_PATTERN_CONDITIONAL }}</span>
            </div>
            <div>
              <span class="text-muted-foreground">With series: </span>
              <span class="text-foreground">Patrick Rothfuss/The Kingkiller Chronicle/01. The Name of the Wind.epub</span>
            </div>
            <div><span class="text-muted-foreground">Without: </span><span class="text-foreground">Andy Weir/Project Hail Mary.epub</span></div>
          </div>
          <div class="rounded-md bg-muted/50 px-4 py-3 space-y-2 text-xs font-mono">
            <div>
              <span class="text-muted-foreground">Pattern: </span><span>{{ EXAMPLE_PATTERN_ELSE }}</span>
            </div>
            <div>
              <span class="text-muted-foreground">With series: </span>
              <span class="text-foreground">The Kingkiller Chronicle/The Name of the Wind.epub</span>
            </div>
            <div><span class="text-muted-foreground">Without: </span><span class="text-foreground">Standalone/Project Hail Mary.epub</span></div>
          </div>
        </div>

        <!-- Folder-only note -->
        <div class="space-y-1">
          <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Folder-only mode</p>
          <p class="text-xs text-muted-foreground leading-relaxed">
            End the pattern with <code class="bg-muted px-1 rounded">/</code> to specify a folder only. The original filename is preserved inside it.
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
