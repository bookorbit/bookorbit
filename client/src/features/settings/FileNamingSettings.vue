<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { Check, ChevronDown, ChevronUp, ClipboardCopy, FileText, Info, Loader2, RotateCcw, Save } from 'lucide-vue-next'
import { DEFAULT_DOWNLOAD_PATTERN, DEFAULT_UPLOAD_PATTERN, PATTERN_TOKENS } from '@projectx/types'
import { toast } from 'vue-sonner'
import { useMediaQuery } from '@vueuse/core'
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

const isMobile = useMediaQuery('(max-width: 767px)')
const referenceOpen = ref(true)
const tokenHelpOpen = ref(false)
const modifierHelpOpen = ref(false)
const conditionalHelpOpen = ref(false)
const examplesOpen = ref(false)

const previewGlobalPattern = ref('')
const previewDownloadPattern = ref('')
let globalPreviewTimer: ReturnType<typeof setTimeout> | null = null
let downloadPreviewTimer: ReturnType<typeof setTimeout> | null = null

const MODIFIERS = [
  { key: ':first', description: 'First value only' },
  { key: ':sort', description: 'Last, First format' },
  { key: ':initial', description: 'First letter only' },
  { key: ':upper', description: 'UPPERCASE' },
  { key: ':lower', description: 'lowercase' },
]

const EXAMPLES = [
  {
    label: 'Calibre-style default',
    pattern: '{authors}/{title}< ({year})>',
    cases: [
      { label: 'with year', result: 'William Gibson/Neuromancer (1984).epub' },
      { label: 'no year', result: 'William Gibson/Neuromancer.epub' },
    ],
  },
  {
    label: 'Series reader',
    pattern: '{authors:first}/<{series}/><{seriesIndex}. >{title}',
    cases: [
      { label: 'in series', result: 'William Gibson/Sprawl/01. Neuromancer.epub' },
      { label: 'standalone', result: 'William Gibson/Neuromancer.epub' },
    ],
  },
  {
    label: 'Clean download filename',
    pattern: '{authors:first} - {title}< ({year})>',
    cases: [
      { label: 'with year', result: 'William Gibson - Neuromancer (1984).epub' },
      { label: 'no year', result: 'William Gibson - Neuromancer.epub' },
    ],
  },
  {
    label: 'Alphabetical grouping with series',
    pattern: '{authors:initial}/{authors:sort}/<{series}/><{seriesIndex}. >{title}',
    cases: [
      { label: 'in series', result: 'G/Gibson, William/Sprawl/01. Neuromancer.epub' },
      { label: 'standalone', result: 'G/Gibson, William/Neuromancer.epub' },
    ],
  },
  {
    label: 'Series or Standalone fallback',
    pattern: '<{series}|Standalone>/<{seriesIndex}. >{title}',
    cases: [
      { label: 'in series', result: 'Sprawl/01. Neuromancer.epub' },
      { label: 'no series', result: 'Standalone/Neuromancer.epub' },
    ],
  },
  {
    label: 'Download with optional subtitle',
    pattern: '{authors:first} - {title}< - {subtitle}>< ({year})>',
    cases: [
      { label: 'full', result: 'Andrew Hunt - The Pragmatic Programmer - From Journeyman to Master (1999).epub' },
      { label: 'minimal', result: 'Andrew Hunt - The Pragmatic Programmer.epub' },
    ],
  },
  {
    label: 'Multilingual library',
    pattern: '<{language:upper}/>{authors}/{title}',
    cases: [
      { label: 'with language', result: 'EN/William Gibson/Neuromancer.epub' },
      { label: 'no language', result: 'William Gibson/Neuromancer.epub' },
    ],
  },
  {
    label: 'Publisher-organized',
    pattern: '<{publisher}/>{authors:first}/{title}',
    cases: [
      { label: 'with publisher', result: "O'Reilly/Andrew Hunt/The Pragmatic Programmer.epub" },
      { label: 'no publisher', result: 'Andrew Hunt/The Pragmatic Programmer.epub' },
    ],
  },
  {
    label: 'Stacked optional folders',
    pattern: '<{language:upper}/><{publisher}|Unknown Publisher>/{authors:first}/{title}',
    cases: [
      { label: 'all set', result: "EN/O'Reilly/Andrew Hunt/The Pragmatic Programmer.epub" },
      { label: 'no language', result: "O'Reilly/Andrew Hunt/The Pragmatic Programmer.epub" },
      { label: 'no publisher', result: 'Unknown Publisher/Andrew Hunt/The Pragmatic Programmer.epub' },
    ],
  },
  {
    label: 'Folder-drop with sort name',
    pattern: '{authors:initial}/{authors:sort}/<{series}/>',
    cases: [
      { label: 'in series', result: 'G/Gibson, William/Sprawl/neuromancer.epub' },
      { label: 'standalone', result: 'G/Gibson, William/neuromancer.epub' },
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

async function copyText(text: string, label: string) {
  await navigator.clipboard.writeText(text)
  toast.success(`${label} copied to clipboard`)
}

function syncPreviewGlobal(value: string) {
  if (globalPreviewTimer) clearTimeout(globalPreviewTimer)
  if (!isMobile.value) {
    previewGlobalPattern.value = value
    return
  }
  globalPreviewTimer = setTimeout(() => {
    previewGlobalPattern.value = value
  }, 250)
}

function syncPreviewDownload(value: string) {
  if (downloadPreviewTimer) clearTimeout(downloadPreviewTimer)
  if (!isMobile.value) {
    previewDownloadPattern.value = value
    return
  }
  downloadPreviewTimer = setTimeout(() => {
    previewDownloadPattern.value = value
  }, 250)
}

onMounted(async () => {
  tokenHelpOpen.value = !isMobile.value
  modifierHelpOpen.value = !isMobile.value
  conditionalHelpOpen.value = !isMobile.value
  examplesOpen.value = !isMobile.value
  await Promise.all([fetchGlobalPattern(), fetchDownloadPattern(), fetchLibraries()])
  previewGlobalPattern.value = globalPattern.value
  previewDownloadPattern.value = downloadPattern.value
})

watch(globalPattern, (value) => syncPreviewGlobal(value), { immediate: true })
watch(downloadPattern, (value) => syncPreviewDownload(value), { immediate: true })
watch(isMobile, (mobile) => {
  tokenHelpOpen.value = !mobile
  modifierHelpOpen.value = !mobile
  conditionalHelpOpen.value = !mobile
  examplesOpen.value = !mobile
  previewGlobalPattern.value = globalPattern.value
  previewDownloadPattern.value = downloadPattern.value
})

const uploadPreviewValue = computed(() => previewPath(previewGlobalPattern.value))
const downloadPreviewValue = computed(() => previewDownloadName(previewDownloadPattern.value))

onUnmounted(() => {
  if (globalPreviewTimer) clearTimeout(globalPreviewTimer)
  if (downloadPreviewTimer) clearTimeout(downloadPreviewTimer)
})
</script>

<template>
  <div class="space-y-10 pb-20">
    <SettingsPageHeader
      class="hidden md:flex"
      title="File Naming"
      subtitle="Control how files are organized on disk when uploaded and how they are named when downloaded using placeholder tokens."
    />
    <div class="md:hidden px-1">
      <h1 class="text-xl font-semibold tracking-tight text-foreground">File Naming</h1>
      <p
        class="mt-1 text-sm text-muted-foreground leading-5 overflow-hidden text-ellipsis [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]"
      >
        Control how files are organized on disk when uploaded and how they are named when downloaded using placeholder tokens.
      </p>
    </div>

    <div class="md:hidden sticky top-[5.25rem] z-20 border border-border/60 bg-card/95 backdrop-blur rounded-lg p-3 space-y-3">
      <div class="space-y-1.5 pt-1 pb-4 border-border/60">
        <div class="flex items-center justify-between gap-2">
          <p class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Upload preview</p>
          <button class="text-xs text-primary hover:underline" @click="copyText(uploadPreviewValue, 'Upload preview')">Copy</button>
        </div>
        <div class="rounded-md border border-border bg-background px-2.5 py-2 font-mono text-xs overflow-x-auto whitespace-nowrap">
          {{ uploadPreviewValue }}
        </div>
      </div>
      <div class="space-y-1.5">
        <div class="flex items-center justify-between gap-2">
          <p class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Download preview</p>
          <button class="text-xs text-primary hover:underline" @click="copyText(downloadPreviewValue, 'Download preview')">Copy</button>
        </div>
        <div class="rounded-md border border-border bg-background px-2.5 py-2 font-mono text-xs overflow-x-auto whitespace-nowrap">
          {{ downloadPreviewValue }}
        </div>
      </div>
    </div>

    <!-- Global Patterns -->
    <section class="space-y-4">
      <p class="settings-group-label">Global Defaults</p>
      <div class="border border-border rounded-lg bg-card overflow-hidden divide-y divide-border shadow-sm">
        <!-- Upload pattern -->
        <div class="px-4 py-4 md:px-6 md:py-5 space-y-4">
          <div class="flex flex-col md:flex-row md:items-start justify-between gap-4">
            <div class="max-w-md">
              <p class="settings-label">Upload Pattern</p>
              <p class="settings-hint">Controls the folder structure and filename for new uploads. Applied to all libraries unless overridden.</p>
            </div>
            <div class="flex flex-col gap-4 w-full md:flex-row md:items-center md:w-auto">
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
                class="flex items-center justify-center gap-2 h-9 px-3 rounded-md bg-primary text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 md:h-8"
                :disabled="savingGlobal || !!globalError || loadingGlobal"
                @click="saveGlobalPattern"
              >
                <Loader2 v-if="savingGlobal" :size="14" class="animate-spin" />
                <Save v-else :size="14" />
                <span>Save</span>
              </button>
            </div>
          </div>

          <div class="hidden md:flex items-center gap-2.5 px-3 py-2 rounded-lg bg-muted/40 border border-border/50 font-mono text-xs">
            <span class="text-muted-foreground shrink-0 uppercase tracking-wider font-semibold text-[10px]">Preview:</span>
            <span class="text-foreground truncate">{{ uploadPreviewValue }}</span>
          </div>
        </div>

        <!-- Download pattern -->
        <div class="px-4 py-4 md:px-6 md:py-5 space-y-4">
          <div class="flex flex-col md:flex-row md:items-start justify-between gap-4">
            <div class="max-w-md">
              <p class="settings-label">Download Pattern</p>
              <p class="settings-hint">Suggested filenames for single-file downloads and files inside export ZIPs.</p>
            </div>
            <div class="flex flex-col gap-4 w-full md:flex-row md:items-center md:w-auto">
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
                class="flex items-center justify-center gap-2 h-9 px-3 rounded-md bg-primary text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 md:h-8"
                :disabled="savingDownload || !!downloadError || loadingDownload"
                @click="saveDownloadPattern"
              >
                <Loader2 v-if="savingDownload" :size="14" class="animate-spin" />
                <Save v-else :size="14" />
                <span>Save</span>
              </button>
            </div>
          </div>

          <div class="hidden md:flex items-center gap-2.5 px-3 py-2 rounded-lg bg-muted/40 border border-border/50 font-mono text-xs">
            <span class="text-muted-foreground shrink-0 uppercase tracking-wider font-semibold text-[10px]">Preview:</span>
            <span class="text-foreground truncate">{{ downloadPreviewValue }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- Library Overrides -->
    <section class="space-y-4">
      <p class="settings-group-label">Library Overrides</p>
      <div class="border border-border rounded-lg bg-card overflow-hidden divide-y divide-border shadow-sm">
        <div v-if="libraries.length === 0" class="px-4 py-8 md:px-6 md:py-10 text-center text-sm text-muted-foreground italic">
          No libraries configured. Create one in Library settings to set custom naming patterns.
        </div>

        <div v-for="lib in libraries" :key="lib.id" class="px-4 py-4 md:px-6 md:py-5 space-y-4">
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
                class="input-field w-full md:w-120 h-9 md:h-8 text-xs px-2.5"
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

      <!-- Reference accordion -->
      <div class="border border-border rounded-lg bg-card shadow-sm overflow-hidden">
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
            <button class="w-full flex items-center justify-between gap-2 text-left" @click="tokenHelpOpen = !tokenHelpOpen">
              <div>
                <p class="text-xs font-semibold text-foreground uppercase tracking-wider">Tokens</p>
                <p class="text-[11px] text-muted-foreground">Copy placeholders quickly</p>
              </div>
              <ChevronUp v-if="tokenHelpOpen" :size="15" class="text-muted-foreground shrink-0" />
              <ChevronDown v-else :size="15" class="text-muted-foreground shrink-0" />
            </button>
            <div v-if="tokenHelpOpen" class="space-y-3">
              <p class="text-xs text-muted-foreground leading-relaxed">Click any token to copy it to your clipboard.</p>
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
                      <ClipboardCopy :size="13" class="shrink-0 text-muted-foreground/60 group-hover:text-primary/60 transition-colors" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Copy {{ '{' + t.token + '}' }}</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>

          <!-- Modifiers -->
          <div class="p-5 space-y-3">
            <button class="w-full flex items-center justify-between gap-2 text-left" @click="modifierHelpOpen = !modifierHelpOpen">
              <div>
                <p class="text-xs font-semibold text-foreground uppercase tracking-wider">Modifiers</p>
                <p class="text-[11px] text-muted-foreground">Transform token values</p>
              </div>
              <ChevronUp v-if="modifierHelpOpen" :size="15" class="text-muted-foreground shrink-0" />
              <ChevronDown v-else :size="15" class="text-muted-foreground shrink-0" />
            </button>
            <div v-if="modifierHelpOpen" class="space-y-3">
              <p class="text-xs text-muted-foreground leading-relaxed">
                Append a modifier inside a token to transform its value:
                <code class="bg-muted px-1.5 py-0.5 rounded font-mono text-foreground text-[11px]">{authors:first}</code>
              </p>
              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                <div
                  v-for="mod in MODIFIERS"
                  :key="mod.key"
                  class="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border bg-background"
                >
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
          </div>

          <!-- Conditional Logic -->
          <div class="p-5 space-y-3">
            <button class="w-full flex items-center justify-between gap-2 text-left" @click="conditionalHelpOpen = !conditionalHelpOpen">
              <div>
                <p class="text-xs font-semibold text-foreground uppercase tracking-wider">Conditional Logic</p>
                <p class="text-[11px] text-muted-foreground">Optional segments and fallbacks</p>
              </div>
              <ChevronUp v-if="conditionalHelpOpen" :size="15" class="text-muted-foreground shrink-0" />
              <ChevronDown v-else :size="15" class="text-muted-foreground shrink-0" />
            </button>
            <p v-if="conditionalHelpOpen" class="text-xs text-muted-foreground leading-relaxed">
              Wrap in <code class="bg-muted px-1 py-0.5 rounded font-mono text-foreground text-[11px]">&lt;...&gt;</code> to skip a segment when its
              token is empty. Use <code class="bg-muted px-1 py-0.5 rounded font-mono text-foreground text-[11px]">|fallback</code> for a default
              value.
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- Examples -->
    <section class="space-y-4">
      <p class="settings-group-label">Examples</p>
      <div class="border border-border rounded-lg bg-card shadow-sm overflow-hidden">
        <div class="p-5 space-y-3">
          <button class="w-full flex items-center justify-between gap-2 text-left" @click="examplesOpen = !examplesOpen">
            <div>
              <p class="text-sm font-medium text-foreground">Pattern Examples</p>
              <p class="text-xs text-muted-foreground">Ready-made patterns for common library styles</p>
            </div>
            <ChevronUp v-if="examplesOpen" :size="15" class="text-muted-foreground shrink-0" />
            <ChevronDown v-else :size="15" class="text-muted-foreground shrink-0" />
          </button>
          <div v-if="examplesOpen" class="space-y-3">
            <div v-for="ex in EXAMPLES" :key="ex.pattern" class="rounded-xl border border-border bg-background overflow-hidden shadow-xs">
              <div class="flex items-center justify-between gap-3 px-4 py-2.5 bg-muted/30 border-b border-border">
                <div class="min-w-0">
                  <p class="text-[13px] font-semibold text-foreground mb-0.5">{{ ex.label }}</p>
                  <div class="overflow-x-auto">
                    <code class="text-[12px] font-mono text-muted-foreground whitespace-nowrap">{{ ex.pattern }}</code>
                  </div>
                </div>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <button
                      class="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium text-muted-foreground border border-border bg-background hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-colors"
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
                  <div class="overflow-x-auto min-w-0">
                    <code class="text-[11.5px] font-mono text-primary/80 whitespace-nowrap">{{ c.result }}</code>
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
