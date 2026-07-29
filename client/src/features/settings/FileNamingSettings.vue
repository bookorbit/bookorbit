<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { BookOpen, Check, CircleHelp, File, FolderOpen, Info, Loader2, RotateCcw } from '@lucide/vue'
import {
  DEFAULT_DOWNLOAD_PATTERN,
  DEFAULT_UPLOAD_PATTERN_BOOK_PER_FILE,
  DEFAULT_UPLOAD_PATTERN_BOOK_PER_FOLDER,
  type Library,
} from '@bookorbit/types'
import { useFileNamingPattern } from './composables/useFileNamingPattern'
import { useDebouncedPatternPreview } from './composables/useDebouncedPatternPreview'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import SettingsPageHeader from './SettingsPageHeader.vue'
import PatternField from './PatternField.vue'
import PatternPreview from './PatternPreview.vue'
import PatternHelpSheet from './PatternHelpSheet.vue'
import AppIcon from '@/components/AppIcon.vue'

const { t } = useI18n()
const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const {
  globalPattern,
  globalError,
  globalDirty,
  folderPattern,
  folderError,
  folderDirty,
  downloadPattern,
  downloadError,
  downloadDirty,
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
  loadLibraries,
  isLibraryDirty,
  onGlobalPatternInput,
  onFolderPatternInput,
  onDownloadPatternInput,
  saveGlobalPattern,
  saveFolderPattern,
  saveDownloadPattern,
  setCrossPlatformSanitization,
  saveLibraryPattern,
  clearLibraryPattern,
  getEffectivePreview,
  previewDownloadName,
  previewPath,
} = useFileNamingPattern()

const helpOpen = ref(false)

const debouncedGlobalPattern = useDebouncedPatternPreview(globalPattern)
const debouncedFolderPattern = useDebouncedPatternPreview(folderPattern)
const debouncedDownloadPattern = useDebouncedPatternPreview(downloadPattern)

const uploadPreviewValue = computed(() => previewPath(debouncedGlobalPattern.value))
const folderPreviewValue = computed(() => previewPath(debouncedFolderPattern.value))
const downloadPreviewValue = computed(() => previewDownloadName(debouncedDownloadPattern.value))

onMounted(async () => {
  await Promise.all([fetchGlobalPattern(), fetchFolderPattern(), fetchDownloadPattern(), fetchCrossPlatformSanitization(), loadLibraries()])
})

function openHelp() {
  helpOpen.value = true
}

function organizationBadgeClass(library: Library): string {
  return library.organizationMode === 'book_per_folder'
    ? 'border-[var(--pill-folder-as-book)]/40 bg-[var(--pill-folder-as-book)]/10 text-[var(--pill-folder-as-book)]'
    : 'border-[var(--pill-file-as-book)]/40 bg-[var(--pill-file-as-book)]/10 text-[var(--pill-file-as-book)]'
}

function libraryPlaceholder(library: Library): string {
  return library.organizationMode === 'book_per_folder'
    ? folderPattern.value || DEFAULT_UPLOAD_PATTERN_BOOK_PER_FOLDER
    : globalPattern.value || DEFAULT_UPLOAD_PATTERN_BOOK_PER_FILE
}
</script>

<template>
  <div class="space-y-8 pb-20">
    <SettingsPageHeader
      v-if="!props.embedded"
      class="hidden md:flex"
      :title="t('settings.reader.fileNaming.title')"
      :subtitle="t('settings.reader.fileNaming.subtitle')"
    />
    <div v-if="!props.embedded" class="px-1 md:hidden">
      <h1 class="text-xl font-semibold tracking-tight text-foreground">{{ t('settings.reader.fileNaming.title') }}</h1>
      <p
        class="mt-1 overflow-hidden text-ellipsis text-sm leading-5 text-muted-foreground [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]"
      >
        {{ t('settings.reader.fileNaming.subtitle') }}
      </p>
    </div>

    <section class="space-y-3">
      <h2 class="settings-group-label mb-0">{{ t('settings.reader.fileNaming.globalDefaults') }}</h2>

      <div class="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card shadow-xs">
        <div class="flex flex-col gap-3 bg-primary/5 px-4 py-4 sm:flex-row sm:items-center sm:justify-between md:px-5 md:py-5">
          <div class="flex max-w-3xl items-start gap-2.5">
            <Info :size="16" class="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
            <p class="text-sm text-muted-foreground">
              {{ t('settings.reader.fileNaming.patternHelpIntro', { titleToken: '{title}', authorsToken: '{authors}' }) }}
            </p>
          </div>
          <button
            type="button"
            class="inline-flex shrink-0 items-center gap-1.5 self-start rounded-md border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:self-auto"
            @click="openHelp"
          >
            <BookOpen :size="14" aria-hidden="true" />
            {{ t('settings.reader.fileNaming.browseTokensAndExamples') }}
          </button>
        </div>

        <div class="flex flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between md:px-5 md:py-5">
          <div class="min-w-0 max-w-2xl">
            <p class="settings-label">{{ t('settings.reader.fileNaming.crossPlatform') }}</p>
            <p class="settings-hint">{{ t('settings.reader.fileNaming.crossPlatformHint') }}</p>
          </div>
          <ToggleSwitch
            :model-value="crossPlatformSanitizationEnabled"
            :disabled="loadingCrossPlatformSanitization || savingCrossPlatformSanitization"
            :aria-label="t('settings.reader.fileNaming.crossPlatform')"
            class="self-start md:ml-4 md:self-auto"
            @update:model-value="setCrossPlatformSanitization"
          />
        </div>

        <PatternField
          field-id="file-naming-file-as-book"
          :label="t('settings.reader.fileNaming.fileAsBookDefault')"
          :hint="t('settings.reader.fileNaming.fileAsBookDefaultHint')"
          :model-value="globalPattern"
          :placeholder="DEFAULT_UPLOAD_PATTERN_BOOK_PER_FILE"
          :preview="uploadPreviewValue"
          :error="globalError"
          :loading="loadingGlobal"
          :saving="savingGlobal"
          :dirty="globalDirty"
          @update:model-value="onGlobalPatternInput"
          @save="saveGlobalPattern"
          @help="openHelp"
        />

        <PatternField
          field-id="file-naming-folder-as-book"
          :label="t('settings.reader.fileNaming.folderAsBookDefault')"
          :hint="t('settings.reader.fileNaming.folderAsBookDefaultHint')"
          :model-value="folderPattern"
          :placeholder="DEFAULT_UPLOAD_PATTERN_BOOK_PER_FOLDER"
          :preview="folderPreviewValue"
          :error="folderError"
          :loading="loadingFolder"
          :saving="savingFolder"
          :dirty="folderDirty"
          @update:model-value="onFolderPatternInput"
          @save="saveFolderPattern"
          @help="openHelp"
        />

        <PatternField
          field-id="file-naming-download"
          :label="t('settings.reader.fileNaming.downloadPattern')"
          :hint="t('settings.reader.fileNaming.downloadPatternHint')"
          :model-value="downloadPattern"
          :placeholder="DEFAULT_DOWNLOAD_PATTERN"
          :preview="downloadPreviewValue"
          :error="downloadError"
          :loading="loadingDownload"
          :saving="savingDownload"
          :dirty="downloadDirty"
          @update:model-value="onDownloadPatternInput"
          @save="saveDownloadPattern"
          @help="openHelp"
        />
      </div>
    </section>

    <section class="space-y-3">
      <div class="flex items-center gap-1.5">
        <h2 class="settings-group-label mb-0">{{ t('settings.reader.fileNaming.libraryOverrides') }}</h2>
        <Tooltip>
          <TooltipTrigger as-child>
            <button
              type="button"
              class="rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              :aria-label="t('settings.reader.fileNaming.patternHelp')"
              @click="openHelp"
            >
              <CircleHelp :size="14" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{{ t('settings.reader.fileNaming.patternHelp') }}</TooltipContent>
        </Tooltip>
      </div>

      <div class="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card shadow-xs">
        <p v-if="libraries.length === 0" class="px-4 py-8 text-center text-sm text-muted-foreground md:px-5 md:py-10">
          {{ t('settings.reader.fileNaming.noLibraries') }}
        </p>

        <div v-for="lib in libraries" :key="lib.id" class="space-y-3 px-4 py-4 md:px-5 md:py-5">
          <div class="flex items-start gap-3">
            <span class="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <AppIcon :icon="lib.icon || 'FolderOpen'" fallback="FolderOpen" :size="16" aria-hidden="true" />
            </span>
            <div class="min-w-0 space-y-1.5">
              <label :for="`file-naming-library-${lib.id}`" class="settings-label block truncate">{{ lib.name }}</label>
              <div class="flex flex-wrap items-center gap-1.5">
                <Badge :variant="lib.fileNamingPattern ? 'secondary' : 'outline'">
                  {{ lib.fileNamingPattern ? t('settings.reader.fileNaming.badgeCustom') : t('settings.reader.fileNaming.badgeDefault') }}
                </Badge>
                <Badge variant="outline" class="gap-1" :class="organizationBadgeClass(lib)">
                  <FolderOpen v-if="lib.organizationMode === 'book_per_folder'" :size="11" aria-hidden="true" />
                  <File v-else :size="11" aria-hidden="true" />
                  {{
                    lib.organizationMode === 'book_per_folder'
                      ? t('settings.reader.fileNaming.orgFolderAsBook')
                      : t('settings.reader.fileNaming.orgFileAsBook')
                  }}
                </Badge>
              </div>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <input
              :id="`file-naming-library-${lib.id}`"
              v-model="lib.fileNamingPattern"
              type="text"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              :placeholder="libraryPlaceholder(lib)"
              class="input-field w-full min-w-0 font-mono"
            />
            <Tooltip>
              <TooltipTrigger as-child>
                <button
                  type="button"
                  class="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  :disabled="savingLibraryId === lib.id || !isLibraryDirty(lib)"
                  :aria-label="t('settings.reader.fileNaming.saveLibraryPattern', { name: lib.name })"
                  @click="saveLibraryPattern(lib)"
                >
                  <Loader2 v-if="savingLibraryId === lib.id" :size="14" class="animate-spin" aria-hidden="true" />
                  <Check v-else :size="14" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{{ t('settings.reader.fileNaming.saveLibraryPattern', { name: lib.name }) }}</TooltipContent>
            </Tooltip>
            <Tooltip v-if="lib.fileNamingPattern">
              <TooltipTrigger as-child>
                <button
                  type="button"
                  class="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:border-destructive/30 hover:bg-destructive/5 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  :aria-label="t('settings.reader.fileNaming.resetLibraryPattern', { name: lib.name })"
                  @click="clearLibraryPattern(lib)"
                >
                  <RotateCcw :size="14" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{{ t('settings.reader.fileNaming.resetToDefault') }}</TooltipContent>
            </Tooltip>
          </div>

          <PatternPreview :value="getEffectivePreview(lib)" :label="lib.name" />
        </div>
      </div>
    </section>

    <PatternHelpSheet v-model:open="helpOpen" />
  </div>
</template>
