<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, ChevronDown, ChevronUp, ClipboardCopy, Info, Loader2, RotateCcw, Save } from '@lucide/vue'
import {
  DEFAULT_DOWNLOAD_PATTERN,
  DEFAULT_UPLOAD_PATTERN_BOOK_PER_FILE,
  DEFAULT_UPLOAD_PATTERN_BOOK_PER_FOLDER,
  PATTERN_TOKENS,
} from '@bookorbit/types'
import { toast } from 'vue-sonner'
import { useMediaQuery } from '@vueuse/core'
import { useFileNamingPattern } from './composables/useFileNamingPattern'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import SettingsPageHeader from './SettingsPageHeader.vue'
import { copyToClipboard } from '@/lib/clipboard'
import AppIcon from '@/components/AppIcon.vue'

const { t } = useI18n()
const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const {
  globalPattern,
  globalError,
  folderPattern,
  folderError,
  downloadPattern,
  downloadError,
  libraries,
  loadingGlobal,
  savingGlobal,
  loadingFolder,
  savingFolder,
  loadingDownload,
  savingDownload,
  crossPlatformSanitizationEnabled,
  loadingCrossPlatformSanitization,
  savingCrossPlatformSanitization,
  savingLibraryId,
  fetchGlobalPattern,
  fetchFolderPattern,
  fetchDownloadPattern,
  fetchCrossPlatformSanitization,
  fetchLibraries,
  onGlobalPatternInput,
  onFolderPatternInput,
  onDownloadPatternInput,
  saveGlobalPattern,
  saveFolderPattern,
  saveDownloadPattern,
  saveCrossPlatformSanitization,
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
const previewFolderPattern = ref('')
const previewDownloadPattern = ref('')
let globalPreviewTimer: ReturnType<typeof setTimeout> | null = null
let folderPreviewTimer: ReturnType<typeof setTimeout> | null = null
let downloadPreviewTimer: ReturnType<typeof setTimeout> | null = null

const MODIFIERS = computed(() => [
  { key: ':first', description: t('settings.reader.fileNaming.modFirst') },
  { key: ':sort', description: t('settings.reader.fileNaming.modSort') },
  { key: ':initial', description: t('settings.reader.fileNaming.modInitial') },
  { key: ':upper', description: 'UPPERCASE' },
  { key: ':lower', description: 'lowercase' },
])

const EXAMPLES = computed(() => [
  {
    label: t('settings.reader.fileNaming.exCalibre'),
    pattern: '{authors}/{title}< ({year})>',
    cases: [
      { label: t('settings.reader.fileNaming.caseWithYear'), result: 'William Gibson/Neuromancer (1984).epub' },
      { label: t('settings.reader.fileNaming.caseNoYear'), result: 'William Gibson/Neuromancer.epub' },
    ],
  },
  {
    label: t('settings.reader.fileNaming.exSeriesReader'),
    pattern: '{authors:first}/<{series}/><{seriesIndex}. >{title}',
    cases: [
      { label: t('settings.reader.fileNaming.caseInSeries'), result: 'William Gibson/Sprawl/01. Neuromancer.epub' },
      { label: t('settings.reader.fileNaming.caseStandalone'), result: 'William Gibson/Neuromancer.epub' },
    ],
  },
  {
    label: t('settings.reader.fileNaming.exCleanDownload'),
    pattern: '{authors:first} - {title}< ({year})>',
    cases: [
      { label: t('settings.reader.fileNaming.caseWithYear'), result: 'William Gibson - Neuromancer (1984).epub' },
      { label: t('settings.reader.fileNaming.caseNoYear'), result: 'William Gibson - Neuromancer.epub' },
    ],
  },
  {
    label: t('settings.reader.fileNaming.exAlphabetical'),
    pattern: '{authors:initial}/{authors:sort}/<{series}/><{seriesIndex}. >{title}',
    cases: [
      { label: t('settings.reader.fileNaming.caseInSeries'), result: 'G/Gibson, William/Sprawl/01. Neuromancer.epub' },
      { label: t('settings.reader.fileNaming.caseStandalone'), result: 'G/Gibson, William/Neuromancer.epub' },
    ],
  },
  {
    label: t('settings.reader.fileNaming.exSeriesFallback'),
    pattern: '<{series}|Standalone>/<{seriesIndex}. >{title}',
    cases: [
      { label: t('settings.reader.fileNaming.caseInSeries'), result: 'Sprawl/01. Neuromancer.epub' },
      { label: t('settings.reader.fileNaming.caseNoSeries'), result: 'Standalone/Neuromancer.epub' },
    ],
  },
  {
    label: t('settings.reader.fileNaming.exOptionalSubtitle'),
    pattern: '{authors:first} - {title}< - {subtitle}>< ({year})>',
    cases: [
      { label: t('settings.reader.fileNaming.caseFull'), result: 'Andrew Hunt - The Pragmatic Programmer - From Journeyman to Master (1999).epub' },
      { label: t('settings.reader.fileNaming.caseMinimal'), result: 'Andrew Hunt - The Pragmatic Programmer.epub' },
    ],
  },
  {
    label: t('settings.reader.fileNaming.exMultilingual'),
    pattern: '<{language:upper}/>{authors}/{title}',
    cases: [
      { label: t('settings.reader.fileNaming.caseWithLanguage'), result: 'EN/William Gibson/Neuromancer.epub' },
      { label: t('settings.reader.fileNaming.caseNoLanguage'), result: 'William Gibson/Neuromancer.epub' },
    ],
  },
  {
    label: t('settings.reader.fileNaming.exPublisher'),
    pattern: '<{publisher}/>{authors:first}/{title}',
    cases: [
      { label: t('settings.reader.fileNaming.caseWithPublisher'), result: "O'Reilly/Andrew Hunt/The Pragmatic Programmer.epub" },
      { label: t('settings.reader.fileNaming.caseNoPublisher'), result: 'Andrew Hunt/The Pragmatic Programmer.epub' },
    ],
  },
  {
    label: t('settings.reader.fileNaming.exStacked'),
    pattern: '<{language:upper}/><{publisher}|Unknown Publisher>/{authors:first}/{title}',
    cases: [
      { label: t('settings.reader.fileNaming.caseAllSet'), result: "EN/O'Reilly/Andrew Hunt/The Pragmatic Programmer.epub" },
      { label: t('settings.reader.fileNaming.caseNoLanguage'), result: "O'Reilly/Andrew Hunt/The Pragmatic Programmer.epub" },
      { label: t('settings.reader.fileNaming.caseNoPublisher'), result: 'Unknown Publisher/Andrew Hunt/The Pragmatic Programmer.epub' },
    ],
  },
  {
    label: t('settings.reader.fileNaming.exFolderDrop'),
    pattern: '{authors:initial}/{authors:sort}/<{series}/>',
    cases: [
      { label: t('settings.reader.fileNaming.caseInSeries'), result: 'G/Gibson, William/Sprawl/neuromancer.epub' },
      { label: t('settings.reader.fileNaming.caseStandalone'), result: 'G/Gibson, William/neuromancer.epub' },
    ],
  },
])

async function copyToken(token: string) {
  const value = `{${token}}`
  const copied = await copyToClipboard(value)
  if (copied) {
    toast.success(t('settings.reader.fileNaming.copiedToClipboard', { value }))
  } else {
    toast.error(t('settings.reader.fileNaming.copyTokenFailed'))
  }
}

async function copyPattern(pattern: string) {
  const copied = await copyToClipboard(pattern)
  if (copied) {
    toast.success(t('settings.reader.fileNaming.patternCopied'))
  } else {
    toast.error(t('settings.reader.fileNaming.copyPatternFailed'))
  }
}

async function copyText(text: string, label: string) {
  const copied = await copyToClipboard(text)
  if (copied) {
    toast.success(t('settings.reader.fileNaming.labelCopied', { label }))
  } else {
    toast.error(t('settings.reader.fileNaming.copyLabelFailed', { label: label.toLowerCase() }))
  }
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

function syncPreviewFolder(value: string) {
  if (folderPreviewTimer) clearTimeout(folderPreviewTimer)
  if (!isMobile.value) {
    previewFolderPattern.value = value
    return
  }
  folderPreviewTimer = setTimeout(() => {
    previewFolderPattern.value = value
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
  await Promise.all([fetchGlobalPattern(), fetchFolderPattern(), fetchDownloadPattern(), fetchCrossPlatformSanitization(), fetchLibraries()])
  previewGlobalPattern.value = globalPattern.value
  previewFolderPattern.value = folderPattern.value
  previewDownloadPattern.value = downloadPattern.value
})

watch(globalPattern, (value) => syncPreviewGlobal(value), { immediate: true })
watch(folderPattern, (value) => syncPreviewFolder(value), { immediate: true })
watch(downloadPattern, (value) => syncPreviewDownload(value), { immediate: true })
watch(isMobile, (mobile) => {
  tokenHelpOpen.value = !mobile
  modifierHelpOpen.value = !mobile
  conditionalHelpOpen.value = !mobile
  examplesOpen.value = !mobile
  previewGlobalPattern.value = globalPattern.value
  previewFolderPattern.value = folderPattern.value
  previewDownloadPattern.value = downloadPattern.value
})

const uploadPreviewValue = computed(() => previewPath(previewGlobalPattern.value))
const folderPreviewValue = computed(() => previewPath(previewFolderPattern.value))
const downloadPreviewValue = computed(() => previewDownloadName(previewDownloadPattern.value))

onUnmounted(() => {
  if (globalPreviewTimer) clearTimeout(globalPreviewTimer)
  if (folderPreviewTimer) clearTimeout(folderPreviewTimer)
  if (downloadPreviewTimer) clearTimeout(downloadPreviewTimer)
})
</script>

<template>
  <div class="space-y-10 pb-20">
    <SettingsPageHeader
      v-if="!props.embedded"
      class="hidden md:flex"
      :title="t('settings.reader.fileNaming.title')"
      :subtitle="t('settings.reader.fileNaming.subtitle')"
    />
    <div v-if="!props.embedded" class="md:hidden px-1">
      <h1 class="text-xl font-semibold tracking-tight text-foreground">{{ t('settings.reader.fileNaming.title') }}</h1>
      <p
        class="mt-1 text-sm text-muted-foreground leading-5 overflow-hidden text-ellipsis [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]"
      >
        {{ t('settings.reader.fileNaming.subtitle') }}
      </p>
    </div>

    <div class="md:hidden border border-border/60 bg-card rounded-lg p-3 space-y-3">
      <div class="space-y-1.5 pt-1 pb-4 border-border/60">
        <div class="flex items-center justify-between gap-2">
          <p class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {{ t('settings.reader.fileNaming.fileAsBookPreview') }}
          </p>
          <button
            class="text-xs text-primary hover:underline"
            @click="copyText(uploadPreviewValue, t('settings.reader.fileNaming.fileAsBookPreview'))"
          >
            {{ t('settings.reader.fileNaming.copy') }}
          </button>
        </div>
        <div class="rounded-md border border-border bg-background px-2.5 py-2 font-mono text-xs overflow-x-auto whitespace-nowrap">
          {{ uploadPreviewValue }}
        </div>
      </div>
      <div class="space-y-1.5 pt-1 pb-4 border-border/60">
        <div class="flex items-center justify-between gap-2">
          <p class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {{ t('settings.reader.fileNaming.folderAsBookPreview') }}
          </p>
          <button
            class="text-xs text-primary hover:underline"
            @click="copyText(folderPreviewValue, t('settings.reader.fileNaming.folderAsBookPreview'))"
          >
            {{ t('settings.reader.fileNaming.copy') }}
          </button>
        </div>
        <div class="rounded-md border border-border bg-background px-2.5 py-2 font-mono text-xs overflow-x-auto whitespace-nowrap">
          {{ folderPreviewValue }}
        </div>
      </div>
      <div class="space-y-1.5">
        <div class="flex items-center justify-between gap-2">
          <p class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {{ t('settings.reader.fileNaming.downloadPreview') }}
          </p>
          <button
            class="text-xs text-primary hover:underline"
            @click="copyText(downloadPreviewValue, t('settings.reader.fileNaming.downloadPreview'))"
          >
            {{ t('settings.reader.fileNaming.copy') }}
          </button>
        </div>
        <div class="rounded-md border border-border bg-background px-2.5 py-2 font-mono text-xs overflow-x-auto whitespace-nowrap">
          {{ downloadPreviewValue }}
        </div>
      </div>
    </div>

    <!-- Global Patterns -->
    <section class="space-y-4">
      <p class="settings-group-label">{{ t('settings.reader.fileNaming.globalDefaults') }}</p>
      <div class="border border-border rounded-lg bg-card overflow-hidden divide-y divide-border shadow-xs">
        <div class="px-4 py-4 md:px-6 md:py-5">
          <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div class="w-full lg:max-w-md">
              <p class="settings-label">{{ t('settings.reader.fileNaming.crossPlatform') }}</p>
              <p class="settings-hint">
                {{ t('settings.reader.fileNaming.crossPlatformHint') }}
              </p>
            </div>
            <div class="flex items-center gap-3 w-full lg:w-auto">
              <ToggleSwitch
                v-model="crossPlatformSanitizationEnabled"
                :disabled="loadingCrossPlatformSanitization || savingCrossPlatformSanitization"
              />
              <button
                class="flex items-center justify-center gap-2 h-9 px-3 rounded-md bg-primary text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 lg:h-8"
                :disabled="loadingCrossPlatformSanitization || savingCrossPlatformSanitization"
                @click="saveCrossPlatformSanitization"
              >
                <Loader2 v-if="savingCrossPlatformSanitization" :size="14" class="animate-spin" />
                <Save v-else :size="14" />
                <span>{{ t('common.save') }}</span>
              </button>
            </div>
          </div>
        </div>

        <!-- File as Book upload pattern -->
        <div class="px-4 py-4 md:px-6 md:py-5 space-y-4">
          <div class="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
            <div class="w-full lg:max-w-md">
              <p class="settings-label">{{ t('settings.reader.fileNaming.fileAsBookDefault') }}</p>
              <p class="settings-hint">{{ t('settings.reader.fileNaming.fileAsBookDefaultHint') }}</p>
            </div>
            <div class="flex flex-col gap-4 w-full lg:flex-row lg:items-center lg:w-auto">
              <div class="relative flex-1 lg:w-120 xl:w-140">
                <input
                  :value="globalPattern"
                  type="text"
                  :placeholder="DEFAULT_UPLOAD_PATTERN_BOOK_PER_FILE"
                  class="input-field w-full"
                  :class="globalError ? 'border-destructive focus:ring-destructive/20' : ''"
                  :disabled="loadingGlobal"
                  @input="onGlobalPatternInput(($event.target as HTMLInputElement).value)"
                />
                <p v-if="globalError" class="absolute -bottom-5 left-0 text-[11px] text-destructive font-medium">{{ globalError }}</p>
              </div>
              <button
                class="flex items-center justify-center gap-2 h-9 px-3 rounded-md bg-primary text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 lg:h-8"
                :disabled="savingGlobal || !!globalError || loadingGlobal"
                @click="saveGlobalPattern"
              >
                <Loader2 v-if="savingGlobal" :size="14" class="animate-spin" />
                <Save v-else :size="14" />
                <span>{{ t('common.save') }}</span>
              </button>
            </div>
          </div>

          <div class="hidden md:flex items-center gap-2.5 px-3 py-2 rounded-lg bg-muted/40 border border-border/50 font-mono text-xs">
            <span class="text-muted-foreground shrink-0 uppercase tracking-wider font-semibold text-[10px]">{{
              t('settings.reader.fileNaming.previewLabel')
            }}</span>
            <span class="text-foreground truncate">{{ uploadPreviewValue }}</span>
          </div>
        </div>

        <!-- Folder as Book upload pattern -->
        <div class="px-4 py-4 md:px-6 md:py-5 space-y-4">
          <div class="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
            <div class="w-full lg:max-w-md">
              <p class="settings-label">{{ t('settings.reader.fileNaming.folderAsBookDefault') }}</p>
              <p class="settings-hint">{{ t('settings.reader.fileNaming.folderAsBookDefaultHint') }}</p>
            </div>
            <div class="flex flex-col gap-4 w-full lg:flex-row lg:items-center lg:w-auto">
              <div class="relative flex-1 lg:w-120 xl:w-140">
                <input
                  :value="folderPattern"
                  type="text"
                  :placeholder="DEFAULT_UPLOAD_PATTERN_BOOK_PER_FOLDER"
                  class="input-field w-full"
                  :class="folderError ? 'border-destructive focus:ring-destructive/20' : ''"
                  :disabled="loadingFolder"
                  @input="onFolderPatternInput(($event.target as HTMLInputElement).value)"
                />
                <p v-if="folderError" class="absolute -bottom-5 left-0 text-[11px] text-destructive font-medium">{{ folderError }}</p>
              </div>
              <button
                class="flex items-center justify-center gap-2 h-9 px-3 rounded-md bg-primary text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 lg:h-8"
                :disabled="savingFolder || !!folderError || loadingFolder"
                @click="saveFolderPattern"
              >
                <Loader2 v-if="savingFolder" :size="14" class="animate-spin" />
                <Save v-else :size="14" />
                <span>{{ t('common.save') }}</span>
              </button>
            </div>
          </div>

          <div class="hidden md:flex items-center gap-2.5 px-3 py-2 rounded-lg bg-muted/40 border border-border/50 font-mono text-xs">
            <span class="text-muted-foreground shrink-0 uppercase tracking-wider font-semibold text-[10px]">{{
              t('settings.reader.fileNaming.previewLabel')
            }}</span>
            <span class="text-foreground truncate">{{ folderPreviewValue }}</span>
          </div>
        </div>

        <!-- Download pattern -->
        <div class="px-4 py-4 md:px-6 md:py-5 space-y-4">
          <div class="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
            <div class="w-full lg:max-w-md">
              <p class="settings-label">{{ t('settings.reader.fileNaming.downloadPattern') }}</p>
              <p class="settings-hint">{{ t('settings.reader.fileNaming.downloadPatternHint') }}</p>
            </div>
            <div class="flex flex-col gap-4 w-full lg:flex-row lg:items-center lg:w-auto">
              <div class="relative flex-1 lg:w-120 xl:w-140">
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
                class="flex items-center justify-center gap-2 h-9 px-3 rounded-md bg-primary text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 lg:h-8"
                :disabled="savingDownload || !!downloadError || loadingDownload"
                @click="saveDownloadPattern"
              >
                <Loader2 v-if="savingDownload" :size="14" class="animate-spin" />
                <Save v-else :size="14" />
                <span>{{ t('common.save') }}</span>
              </button>
            </div>
          </div>

          <div class="hidden md:flex items-center gap-2.5 px-3 py-2 rounded-lg bg-muted/40 border border-border/50 font-mono text-xs">
            <span class="text-muted-foreground shrink-0 uppercase tracking-wider font-semibold text-[10px]">{{
              t('settings.reader.fileNaming.previewLabel')
            }}</span>
            <span class="text-foreground truncate">{{ downloadPreviewValue }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- Library Overrides -->
    <section class="space-y-4">
      <p class="settings-group-label">{{ t('settings.reader.fileNaming.libraryOverrides') }}</p>
      <div class="border border-border rounded-lg bg-card overflow-hidden divide-y divide-border shadow-xs">
        <div v-if="libraries.length === 0" class="px-4 py-8 md:px-6 md:py-10 text-center text-sm text-muted-foreground italic">
          {{ t('settings.reader.fileNaming.noLibraries') }}
        </div>

        <div v-for="lib in libraries" :key="lib.id" class="px-4 py-4 md:px-6 md:py-5 space-y-3">
          <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div class="flex items-center gap-3 min-w-0">
              <div class="flex items-center justify-center w-8 h-8 rounded-lg bg-muted shrink-0 text-muted-foreground">
                <AppIcon :icon="lib.icon || 'FolderOpen'" fallback="FolderOpen" :size="16" />
              </div>
              <div class="min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="settings-label truncate">{{ lib.name }}</span>
                  <Badge v-if="lib.fileNamingPattern" variant="secondary" class="h-4.5 px-1.5 text-[10px] font-bold uppercase tracking-tight">
                    {{ t('settings.reader.fileNaming.badgeCustom') }}
                  </Badge>
                  <Badge v-else variant="outline" class="h-4.5 px-1.5 text-[10px] font-bold uppercase tracking-tight opacity-60">
                    {{ t('settings.reader.fileNaming.badgeDefault') }}
                  </Badge>
                  <Badge
                    variant="outline"
                    class="h-4.5 px-1.5 text-[10px] font-bold uppercase tracking-tight"
                    :class="
                      lib.organizationMode === 'book_per_folder' ? 'text-blue-500 border-blue-500/40' : 'text-emerald-500 border-emerald-500/40'
                    "
                  >
                    {{
                      lib.organizationMode === 'book_per_folder'
                        ? t('settings.reader.fileNaming.orgFolderAsBook')
                        : t('settings.reader.fileNaming.orgFileAsBook')
                    }}
                  </Badge>
                </div>
              </div>
            </div>

            <div class="flex items-center gap-2 w-full lg:w-auto">
              <input
                v-model="lib.fileNamingPattern"
                type="text"
                :placeholder="
                  lib.organizationMode === 'book_per_folder'
                    ? folderPattern || DEFAULT_UPLOAD_PATTERN_BOOK_PER_FOLDER
                    : globalPattern || DEFAULT_UPLOAD_PATTERN_BOOK_PER_FILE
                "
                class="input-field w-full lg:w-120 h-9 lg:h-8 text-xs px-2.5"
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
                <TooltipContent>{{ t('settings.reader.fileNaming.resetToDefault') }}</TooltipContent>
              </Tooltip>
            </div>
          </div>

          <div class="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-muted/40 border border-border/50 text-xs">
            <span class="text-muted-foreground shrink-0 uppercase tracking-wider font-semibold text-[10px]">{{
              t('settings.reader.fileNaming.previewLabel')
            }}</span>
            <div class="overflow-x-auto min-w-0 font-mono">
              <span class="text-foreground whitespace-nowrap">{{ getEffectivePreview(lib) }}</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Placeholder Reference -->
    <section class="space-y-4">
      <p class="settings-group-label">{{ t('settings.reader.fileNaming.patternReference') }}</p>

      <!-- Reference accordion -->
      <div class="border border-border rounded-lg bg-card shadow-xs overflow-hidden">
        <button
          class="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-muted/30 transition-colors"
          @click="referenceOpen = !referenceOpen"
        >
          <div class="flex items-center gap-2.5">
            <Info :size="16" class="text-primary shrink-0" />
            <span class="text-sm font-medium text-foreground">{{ t('settings.reader.fileNaming.placeholderReference') }}</span>
            <span class="hidden sm:inline text-xs text-muted-foreground">{{ t('settings.reader.fileNaming.placeholderReferenceHint') }}</span>
          </div>
          <ChevronUp v-if="referenceOpen" :size="16" class="text-muted-foreground shrink-0" />
          <ChevronDown v-else :size="16" class="text-muted-foreground shrink-0" />
        </button>

        <div v-if="referenceOpen" class="border-t border-border animate-in fade-in slide-in-from-top-1 duration-200 divide-y divide-border">
          <!-- Tokens -->
          <div class="p-5 space-y-3">
            <button class="w-full flex items-center justify-between gap-2 text-left" @click="tokenHelpOpen = !tokenHelpOpen">
              <div>
                <p class="text-xs font-semibold text-foreground uppercase tracking-wider">{{ t('settings.reader.fileNaming.tokens') }}</p>
                <p class="text-[11px] text-muted-foreground">{{ t('settings.reader.fileNaming.tokensHint') }}</p>
              </div>
              <ChevronUp v-if="tokenHelpOpen" :size="15" class="text-muted-foreground shrink-0" />
              <ChevronDown v-else :size="15" class="text-muted-foreground shrink-0" />
            </button>
            <div v-if="tokenHelpOpen" class="space-y-3">
              <p class="text-xs text-muted-foreground leading-relaxed">{{ t('settings.reader.fileNaming.clickTokenHint') }}</p>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                <Tooltip v-for="tok in PATTERN_TOKENS" :key="tok.token">
                  <TooltipTrigger as-child>
                    <button
                      class="group flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-border bg-background text-left hover:border-primary/40 hover:bg-primary/5 transition-colors"
                      @click="copyToken(tok.token)"
                    >
                      <div class="min-w-0">
                        <code class="text-xs font-mono font-semibold text-primary">{{ '{' + tok.token + '}' }}</code>
                        <p class="text-[11px] text-muted-foreground leading-tight mt-0.5">{{ tok.description }}</p>
                      </div>
                      <ClipboardCopy :size="13" class="shrink-0 text-muted-foreground/60 group-hover:text-primary/60 transition-colors" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{{ t('settings.reader.fileNaming.copyValue', { value: '{' + tok.token + '}' }) }}</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>

          <!-- Modifiers -->
          <div class="p-5 space-y-3">
            <button class="w-full flex items-center justify-between gap-2 text-left" @click="modifierHelpOpen = !modifierHelpOpen">
              <div>
                <p class="text-xs font-semibold text-foreground uppercase tracking-wider">{{ t('settings.reader.fileNaming.modifiers') }}</p>
                <p class="text-[11px] text-muted-foreground">{{ t('settings.reader.fileNaming.modifiersHint') }}</p>
              </div>
              <ChevronUp v-if="modifierHelpOpen" :size="15" class="text-muted-foreground shrink-0" />
              <ChevronDown v-else :size="15" class="text-muted-foreground shrink-0" />
            </button>
            <div v-if="modifierHelpOpen" class="space-y-3">
              <p class="text-xs text-muted-foreground leading-relaxed">
                {{ t('settings.reader.fileNaming.modifiersExplain') }}
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
                  {{ t('settings.reader.fileNaming.folderOnlyPrefix') }}
                  <code class="bg-primary/10 text-primary px-1 py-0.5 rounded font-mono text-[11px]">/</code>
                  {{ t('settings.reader.fileNaming.folderOnlySuffix') }}
                </p>
              </div>
            </div>
          </div>

          <!-- Conditional Logic -->
          <div class="p-5 space-y-3">
            <button class="w-full flex items-center justify-between gap-2 text-left" @click="conditionalHelpOpen = !conditionalHelpOpen">
              <div>
                <p class="text-xs font-semibold text-foreground uppercase tracking-wider">{{ t('settings.reader.fileNaming.conditionalLogic') }}</p>
                <p class="text-[11px] text-muted-foreground">{{ t('settings.reader.fileNaming.conditionalLogicHint') }}</p>
              </div>
              <ChevronUp v-if="conditionalHelpOpen" :size="15" class="text-muted-foreground shrink-0" />
              <ChevronDown v-else :size="15" class="text-muted-foreground shrink-0" />
            </button>
            <p v-if="conditionalHelpOpen" class="text-xs text-muted-foreground leading-relaxed">
              {{ t('settings.reader.fileNaming.conditionalPart1') }}
              <code class="bg-muted px-1 py-0.5 rounded font-mono text-foreground text-[11px]">&lt;...&gt;</code>
              {{ t('settings.reader.fileNaming.conditionalPart2') }}
              <code class="bg-muted px-1 py-0.5 rounded font-mono text-foreground text-[11px]">|fallback</code>
              {{ t('settings.reader.fileNaming.conditionalPart3') }}
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- Examples -->
    <section class="space-y-4">
      <p class="settings-group-label">{{ t('settings.reader.fileNaming.examples') }}</p>
      <div class="border border-border rounded-lg bg-card shadow-xs overflow-hidden">
        <div class="p-5 space-y-3">
          <button class="w-full flex items-center justify-between gap-2 text-left" @click="examplesOpen = !examplesOpen">
            <div>
              <p class="text-sm font-medium text-foreground">{{ t('settings.reader.fileNaming.patternExamples') }}</p>
              <p class="text-xs text-muted-foreground">{{ t('settings.reader.fileNaming.patternExamplesHint') }}</p>
            </div>
            <ChevronUp v-if="examplesOpen" :size="15" class="text-muted-foreground shrink-0" />
            <ChevronDown v-else :size="15" class="text-muted-foreground shrink-0" />
          </button>
          <div v-if="examplesOpen" class="space-y-3">
            <div v-for="ex in EXAMPLES" :key="ex.pattern" class="rounded-lg border border-border bg-background overflow-hidden shadow-xs">
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
                      {{ t('settings.reader.fileNaming.copy') }}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{{ t('settings.reader.fileNaming.copyPatternTooltip') }}</TooltipContent>
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
