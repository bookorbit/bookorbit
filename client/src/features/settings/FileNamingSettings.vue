<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Check, ChevronDown, ChevronUp, ClipboardCopy, FileText, Info, Loader2, RotateCcw, Save } from 'lucide-vue-next'
import { DEFAULT_DOWNLOAD_PATTERN, DEFAULT_UPLOAD_PATTERN, PATTERN_TOKENS } from '@projectx/types'
import { toast } from 'vue-sonner'
import { useFileNamingPattern } from './composables/useFileNamingPattern'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import SettingsPageHeader from './SettingsPageHeader.vue'

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

async function copyToken(token: string) {
  await navigator.clipboard.writeText(`{${token}}`)
  toast.success(`{${token}} copied to clipboard`)
}

async function copyPattern(pattern: string) {
  await navigator.clipboard.writeText(pattern)
  toast.success('Pattern copied to clipboard')
}

onMounted(async () => {
  await Promise.all([fetchGlobalPattern(), fetchDownloadPattern(), fetchLibraries()])
})
</script>

<template>
  <div class="space-y-10 pb-20">
    <SettingsPageHeader
      title="File Naming"
      subtitle="Control how files are organized on disk when uploaded and how they are named when downloaded using placeholder tokens."
    />

    <!-- Global Patterns -->
    <section class="space-y-4">
      <p class="settings-group-label">Global Defaults</p>
      <div class="border border-border rounded-lg bg-card overflow-hidden divide-y divide-border shadow-sm">
        <!-- Upload pattern -->
        <div class="px-6 py-5 space-y-4">
          <div class="flex flex-col md:flex-row md:items-start justify-between gap-4">
            <div class="max-w-md">
              <p class="settings-label">Upload Pattern</p>
              <p class="settings-hint">Controls the folder structure and filename for new uploads. Applied to all libraries unless overridden.</p>
            </div>
            <div class="flex items-center gap-2 w-full md:w-auto">
              <div class="relative flex-1 md:w-120">
                <input
                  :value="globalPattern"
                  type="text"
                  :placeholder="DEFAULT_UPLOAD_PATTERN"
                  class="input-field w-full"
                  :class="globalError ? 'border-destructive focus:ring-destructive/20' : ''"
                  :disabled="loadingGlobal"
                  @input="onGlobalPatternInput(($event.target as HTMLInputElement).value)"
                />
                <p v-if="globalError" class="absolute -bottom-5 left-0 text-[11px] text-destructive font-medium">{{ globalError }}</p>
              </div>
              <button
                class="flex items-center gap-2 h-9 px-3 rounded-md bg-primary text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                :disabled="savingGlobal || !!globalError || loadingGlobal"
                @click="saveGlobalPattern"
              >
                <Loader2 v-if="savingGlobal" :size="14" class="animate-spin" />
                <Save v-else :size="14" />
                <span>Save</span>
              </button>
            </div>
          </div>

          <div class="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-muted/40 border border-border/50 font-mono text-xs">
            <span class="text-muted-foreground shrink-0 uppercase tracking-wider font-semibold text-[10px]">Preview:</span>
            <span class="text-foreground truncate">{{ previewPath(globalPattern) }}</span>
          </div>
        </div>

        <!-- Download pattern -->
        <div class="px-6 py-5 space-y-4">
          <div class="flex flex-col md:flex-row md:items-start justify-between gap-4">
            <div class="max-w-md">
              <p class="settings-label">Download Pattern</p>
              <p class="settings-hint">Suggested filenames for single-file downloads and files inside export ZIPs.</p>
            </div>
            <div class="flex items-center gap-2 w-full md:w-auto">
              <div class="relative flex-1 md:w-120">
                <input
                  :value="downloadPattern"
                  type="text"
                  :placeholder="DEFAULT_DOWNLOAD_PATTERN"
                  class="input-field w-full"
                  :class="downloadError ? 'border-destructive focus:ring-destructive/20' : ''"
                  :disabled="loadingDownload"
                  @input="onDownloadPatternInput(($event.target as HTMLInputElement).value)"
                />
                <p v-if="downloadError" class="absolute -bottom-5 left-0 text-[11px] text-destructive font-medium">{{ downloadError }}</p>
              </div>
              <button
                class="flex items-center gap-2 h-9 px-3 rounded-md bg-primary text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                :disabled="savingDownload || !!downloadError || loadingDownload"
                @click="saveDownloadPattern"
              >
                <Loader2 v-if="savingDownload" :size="14" class="animate-spin" />
                <Save v-else :size="14" />
                <span>Save</span>
              </button>
            </div>
          </div>

          <div class="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-muted/40 border border-border/50 font-mono text-xs">
            <span class="text-muted-foreground shrink-0 uppercase tracking-wider font-semibold text-[10px]">Preview:</span>
            <span class="text-foreground truncate">{{ previewDownloadName(downloadPattern) }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- Library Overrides -->
    <section class="space-y-4">
      <p class="settings-group-label">Library Overrides</p>
      <div class="border border-border rounded-lg bg-card overflow-hidden divide-y divide-border shadow-sm">
        <div v-if="libraries.length === 0" class="px-6 py-10 text-center text-sm text-muted-foreground italic">
          No libraries configured. Create one in Library settings to set custom naming patterns.
        </div>

        <div v-for="lib in libraries" :key="lib.id" class="px-6 py-5 space-y-4">
          <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div class="flex items-center gap-3">
              <div class="flex items-center justify-center w-8 h-8 rounded-lg bg-muted shrink-0 text-muted-foreground">
                <FileText :size="16" />
              </div>
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <span class="settings-label truncate">{{ lib.name }}</span>
                  <Badge v-if="lib.fileNamingPattern" variant="secondary" class="h-4.5 px-1.5 text-[10px] font-bold uppercase tracking-tight">
                    Custom
                  </Badge>
                  <Badge v-else variant="outline" class="h-4.5 px-1.5 text-[10px] font-bold uppercase tracking-tight opacity-60"> Default </Badge>
                </div>
                <p class="text-xs text-muted-foreground font-mono truncate max-w-[300px]">
                  {{ getEffectivePreview(lib) }}
                </p>
              </div>
            </div>

            <div class="flex items-center gap-2">
              <input
                v-model="lib.fileNamingPattern"
                type="text"
                :placeholder="globalPattern || DEFAULT_UPLOAD_PATTERN"
                class="input-field w-full md:w-120 h-8 text-xs px-2.5"
              />
              <button
                class="shrink-0 flex items-center justify-center h-8 w-8 rounded-md border border-border bg-background text-muted-foreground hover:text-primary hover:bg-primary/5 hover:border-primary/30 transition-all disabled:opacity-50"
                :disabled="savingLibraryId === lib.id"
                @click="saveLibraryPattern(lib)"
              >
                <Loader2 v-if="savingLibraryId === lib.id" :size="14" class="animate-spin" />
                <Check v-else :size="14" />
              </button>
              <Tooltip v-if="lib.fileNamingPattern">
                <TooltipTrigger as-child>
                  <button
                    class="shrink-0 flex items-center justify-center h-8 w-8 rounded-md border border-border bg-background text-muted-foreground hover:text-destructive hover:bg-destructive/5 hover:border-destructive/30 transition-all"
                    @click="clearLibraryPattern(lib)"
                  >
                    <RotateCcw :size="13" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Reset to default</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Placeholder Reference -->
    <section class="space-y-4">
      <p class="settings-group-label">Pattern Reference</p>
      <div class="border border-border rounded-lg bg-card shadow-sm overflow-hidden">
        <!-- Accordion header -->
        <button
          class="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-muted/30 transition-colors"
          @click="referenceOpen = !referenceOpen"
        >
          <div class="flex items-center gap-2.5">
            <Info :size="16" class="text-primary shrink-0" />
            <span class="text-sm font-medium text-foreground">Placeholder Reference</span>
            <span class="hidden sm:inline text-xs text-muted-foreground">- guide for creating custom naming patterns</span>
          </div>
          <ChevronUp v-if="referenceOpen" :size="16" class="text-muted-foreground shrink-0" />
          <ChevronDown v-else :size="16" class="text-muted-foreground shrink-0" />
        </button>

        <div v-if="referenceOpen" class="border-t border-border animate-in fade-in slide-in-from-top-1 duration-200 divide-y divide-border">
          <!-- Tokens -->
          <div class="p-5 space-y-3">
            <p class="text-xs font-semibold text-foreground uppercase tracking-wider">Tokens</p>
            <p class="text-xs text-muted-foreground">Click any token to copy it to your clipboard.</p>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              <Tooltip v-for="t in PATTERN_TOKENS" :key="t.token">
                <TooltipTrigger as-child>
                  <button
                    class="group flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-border bg-background text-left hover:border-primary/40 hover:bg-primary/5 transition-colors"
                    @click="copyToken(t.token)"
                  >
                    <div class="min-w-0">
                      <code class="text-xs font-mono font-semibold text-primary">{{ '{' + t.token + '}' }}</code>
                      <p class="text-[11px] text-muted-foreground leading-tight mt-0.5">{{ t.description }}</p>
                    </div>
                    <ClipboardCopy :size="13" class="shrink-0 text-muted-foreground/40 group-hover:text-primary/60 transition-colors" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Copy {{ '{' + t.token + '}' }}</TooltipContent>
              </Tooltip>
            </div>
          </div>

          <!-- Modifiers -->
          <div class="p-5 space-y-4">
            <p class="text-xs font-semibold text-foreground uppercase tracking-wider">Modifiers</p>
            <p class="text-xs text-muted-foreground leading-relaxed">
              Append a modifier inside a token to transform its value:
              <code class="bg-muted px-1.5 py-0.5 rounded font-mono text-foreground text-[11px]">{authors:first}</code>
            </p>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              <div v-for="mod in MODIFIERS" :key="mod.key" class="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border bg-background">
                <code class="text-xs font-mono font-semibold text-foreground shrink-0">{{ mod.key }}</code>
                <span class="text-xs text-muted-foreground">{{ mod.description }}</span>
              </div>
            </div>
            <div class="flex items-start gap-3 px-4 py-3 rounded-lg bg-primary/5 border border-primary/10">
              <code class="text-sm font-mono text-primary shrink-0 mt-0.5">/</code>
              <p class="text-xs text-muted-foreground leading-relaxed">
                End a pattern with <code class="bg-primary/10 text-primary px-1 py-0.5 rounded font-mono text-[11px]">/</code> to specify a folder
                only. The original filename will be preserved inside it.
              </p>
            </div>
          </div>

          <!-- Examples -->
          <div class="p-5 space-y-3">
            <p class="text-xs font-semibold text-foreground uppercase tracking-wider">Conditional Logic</p>
            <p class="text-xs text-muted-foreground leading-relaxed">
              Wrap in <code class="bg-muted px-1 py-0.5 rounded font-mono text-foreground text-[11px]">&lt;...&gt;</code> to skip a segment when its
              token is empty. Use <code class="bg-muted px-1 py-0.5 rounded font-mono text-foreground text-[11px]">|fallback</code> for a default
              value.
            </p>
            <div class="space-y-3">
              <div v-for="ex in EXAMPLES" :key="ex.pattern" class="rounded-xl border border-border bg-background overflow-hidden shadow-xs">
                <div class="flex items-center justify-between gap-3 px-4 py-2.5 bg-muted/30 border-b border-border">
                  <code class="text-[11px] font-mono text-foreground break-all leading-relaxed">{{ ex.pattern }}</code>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <button
                        class="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium text-muted-foreground border border-border bg-background hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-colors"
                        @click="copyPattern(ex.pattern)"
                      >
                        <ClipboardCopy :size="12" />
                        Copy
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Copy pattern to clipboard</TooltipContent>
                  </Tooltip>
                </div>
                <div class="px-4 py-3 space-y-2">
                  <div v-for="c in ex.cases" :key="c.label" class="flex items-baseline gap-2">
                    <span class="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold shrink-0 w-20">{{ c.label }}</span>
                    <code class="text-[11px] font-mono text-primary/80 break-all leading-tight">{{ c.result }}</code>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
