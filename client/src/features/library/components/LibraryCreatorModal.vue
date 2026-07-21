<script setup lang="ts">
import { computed, onMounted, ref, watch, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  AlertCircle,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileEdit,
  FolderOpen,
  Info,
  Loader2,
  ScanLine,
  Tags,
  Users,
  X,
} from '@lucide/vue'
import type { CoverAspectRatio, Library, OrganizationMode } from '@bookorbit/types'
import { useModal } from '@/composables/useModal'
import { api } from '@/lib/api'
import { useLibraryCreator, type LibraryCreatorSectionId } from '../composables/useLibraryCreator'
import LibraryCreatorAccess from './LibraryCreatorAccess.vue'
import LibraryCreatorDetails from './LibraryCreatorDetails.vue'
import LibraryCreatorFileWrite from './LibraryCreatorFileWrite.vue'
import LibraryCreatorFolders from './LibraryCreatorFolders.vue'
import LibraryCreatorMetadata from './LibraryCreatorMetadata.vue'
import LibraryCreatorReading from './LibraryCreatorReading.vue'
import LibraryCreatorScanner from './LibraryCreatorScanner.vue'
import LibraryCreatorSchedule from './LibraryCreatorSchedule.vue'

const { t } = useI18n()

const props = defineProps<{
  library?: Library | null
}>()

const emit = defineEmits<{
  close: []
  saved: [library: Library]
}>()

interface CreatorSection {
  id: LibraryCreatorSectionId
  label: string
  description: string
  icon: Component
  component: Component
  required?: boolean
}

const ALL_SECTIONS: CreatorSection[] = [
  {
    id: 'details',
    label: 'Details',
    description: 'Name your library and choose how its covers appear.',
    icon: Info,
    component: LibraryCreatorDetails,
    required: true,
  },
  {
    id: 'folders',
    label: 'Folders',
    description: 'Choose the server folders that contain your books.',
    icon: FolderOpen,
    component: LibraryCreatorFolders,
    required: true,
  },
  {
    id: 'scanner',
    label: 'Scanning',
    description: 'Control how files are grouped, included, and excluded.',
    icon: ScanLine,
    component: LibraryCreatorScanner,
  },
  {
    id: 'metadata',
    label: 'Metadata',
    description: 'Choose which metadata sources and formats take priority.',
    icon: Tags,
    component: LibraryCreatorMetadata,
  },
  {
    id: 'reading',
    label: 'Reading',
    description: 'Set when books automatically move between reading states.',
    icon: BookOpen,
    component: LibraryCreatorReading,
  },
  {
    id: 'schedule',
    label: 'Automation',
    description: 'Watch folders and schedule recurring library scans.',
    icon: Clock,
    component: LibraryCreatorSchedule,
  },
  {
    id: 'fileWrite',
    label: 'File updates',
    description: 'Optionally rename files or write metadata back to disk.',
    icon: FileEdit,
    component: LibraryCreatorFileWrite,
  },
  {
    id: 'access',
    label: 'Access',
    description: 'Choose who can view, edit, or manage this library.',
    icon: Users,
    component: LibraryCreatorAccess,
  },
]

const creator = useLibraryCreator()
const { form, mode, editingLibraryId, loading, prescanLoading, prescanResult, error, validationErrors } = creator
const panel = ref<HTMLElement | null>(null)
const stepIndex = ref(0)
const visitedUpTo = ref(0)
const initializing = ref(true)
const initializationWarning = ref<string | null>(null)
const initialFormSnapshot = ref('')
const nestedModalOpen = ref(false)
const attemptedSections = ref(new Set<LibraryCreatorSectionId>())

const sections = computed(() => (mode.value === 'create' ? ALL_SECTIONS.filter((section) => section.id !== 'access') : ALL_SECTIONS))
const activeSection = computed(() => sections.value[stepIndex.value] ?? sections.value[0]!)
const ActiveComponent = computed(() => activeSection.value.component)
const activeId = computed(() => activeSection.value.id)
const isFirstStep = computed(() => stepIndex.value === 0)
const isLastStep = computed(() => stepIndex.value === sections.value.length - 1)
const stepValid = computed(() => !validationErrors.value[activeId.value])
const requiredSetupValid = computed(() => !validationErrors.value.details && !validationErrors.value.folders)
const isDirty = computed(() => !initializing.value && initialFormSnapshot.value !== JSON.stringify(form))
const progressWidth = computed(() => `${((stepIndex.value + 1) / sections.value.length) * 100}%`)
const title = computed(() => (props.library ? `Edit ${form.name || props.library.name}` : 'Create a library'))
const displayedError = computed(() => error.value || sectionError(activeId.value))

watch(
  () => JSON.stringify(form),
  () => {
    error.value = null
  },
)

const sectionProps = computed(() => ({
  details: { name: form.name, icon: form.icon, coverAspectRatio: form.coverAspectRatio },
  folders: { folders: form.folders, prescanResult: prescanResult.value, prescanLoading: prescanLoading.value },
  scanner: {
    organizationMode: form.organizationMode,
    organizationModeLocked: mode.value === 'edit',
    allowedFormats: form.allowedFormats,
    excludePatterns: form.excludePatterns,
  },
  metadata: { metadataPrecedence: form.metadataPrecedence, formatPriority: form.formatPriority },
  reading: {
    readingThreshold: form.readingThreshold,
    markAsFinishedPercentComplete: form.markAsFinishedPercentComplete,
  },
  schedule: { watch: form.watch, autoScanCronExpression: form.autoScanCronExpression },
  fileWrite: {
    fileRenameEnabled: form.fileRenameEnabled,
    fileWriteEnabled: form.fileWriteEnabled,
    fileWriteWriteCover: form.fileWriteWriteCover,
    fileWriteEpubEnabled: form.fileWriteEpubEnabled,
    fileWriteEpubMaxFileSizeMb: form.fileWriteEpubMaxFileSizeMb,
    fileWritePdfEnabled: form.fileWritePdfEnabled,
    fileWritePdfMaxFileSizeMb: form.fileWritePdfMaxFileSizeMb,
    fileWriteCbxEnabled: form.fileWriteCbxEnabled,
    fileWriteCbxMaxFileSizeMb: form.fileWriteCbxMaxFileSizeMb,
    fileWriteAudioEnabled: form.fileWriteAudioEnabled,
    fileWriteAudioMaxFileSizeMb: form.fileWriteAudioMaxFileSizeMb,
  },
  access: { libraryId: editingLibraryId.value },
}))

function getSectionProps(id: LibraryCreatorSectionId) {
  return sectionProps.value[id]
}

function requestClose() {
  if (loading.value || nestedModalOpen.value) return
  if (isDirty.value && !window.confirm('Discard your unsaved library changes?')) return
  emit('close')
}

function goTo(index: number) {
  if (index < 0 || index >= sections.value.length) return
  if (mode.value === 'create' && index > visitedUpTo.value) return
  stepIndex.value = index
  error.value = null
}

function next() {
  if (isLastStep.value) return
  if (!stepValid.value) {
    markSectionAttempted(activeId.value)
    error.value = validationErrors.value[activeId.value] ?? null
    return
  }
  stepIndex.value += 1
  visitedUpTo.value = Math.max(visitedUpTo.value, stepIndex.value)
  error.value = null
}

function back() {
  if (isFirstStep.value) requestClose()
  else goTo(stepIndex.value - 1)
}

function goToFirstInvalidSection(): boolean {
  const invalidIndex = sections.value.findIndex((section) => validationErrors.value[section.id])
  if (invalidIndex === -1) return false
  visitedUpTo.value = Math.max(visitedUpTo.value, invalidIndex)
  stepIndex.value = invalidIndex
  markSectionAttempted(sections.value[invalidIndex]!.id)
  error.value = validationErrors.value[sections.value[invalidIndex]!.id] ?? null
  return true
}

function markSectionAttempted(id: LibraryCreatorSectionId) {
  attemptedSections.value = new Set(attemptedSections.value).add(id)
}

function sectionError(id: LibraryCreatorSectionId): string | null {
  return attemptedSections.value.has(id) ? (validationErrors.value[id] ?? null) : null
}

async function handleSave() {
  if (goToFirstInvalidSection()) return
  const saved = await creator.save()
  if (saved) emit('saved', saved)
}

function handleNameUpdate(value: string) {
  form.name = value
}

function handleIconUpdate(value: string | null) {
  form.icon = value
}

function handleCoverAspectRatioUpdate(value: CoverAspectRatio) {
  form.coverAspectRatio = value
}

function handleFoldersUpdate(value: string[]) {
  form.folders = value
  prescanResult.value = null
}

function handleOrganizationModeUpdate(value: OrganizationMode) {
  form.organizationMode = value
}

function handleNestedModalChange(value: boolean) {
  nestedModalOpen.value = value
}

const sectionListeners = {
  'update:name': handleNameUpdate,
  'update:icon': handleIconUpdate,
  'update:coverAspectRatio': handleCoverAspectRatioUpdate,
  'update:folders': handleFoldersUpdate,
  'update:organizationMode': handleOrganizationModeUpdate,
  'update:metadataPrecedence': (value: string[]) => (form.metadataPrecedence = value),
  'update:formatPriority': (value: string[]) => (form.formatPriority = value),
  'update:allowedFormats': (value: string[]) => (form.allowedFormats = value),
  'update:excludePatterns': (value: string[]) => (form.excludePatterns = value),
  'update:readingThreshold': (value: number) => (form.readingThreshold = value),
  'update:markAsFinishedPercentComplete': (value: number) => (form.markAsFinishedPercentComplete = value),
  'update:watch': (value: boolean) => (form.watch = value),
  'update:autoScanCronExpression': (value: string | null) => (form.autoScanCronExpression = value),
  'update:fileRenameEnabled': (value: boolean) => (form.fileRenameEnabled = value),
  'update:fileWriteEnabled': (value: boolean) => (form.fileWriteEnabled = value),
  'update:fileWriteWriteCover': (value: boolean) => (form.fileWriteWriteCover = value),
  'update:fileWriteEpubEnabled': (value: boolean) => (form.fileWriteEpubEnabled = value),
  'update:fileWriteEpubMaxFileSizeMb': (value: number) => (form.fileWriteEpubMaxFileSizeMb = value),
  'update:fileWritePdfEnabled': (value: boolean) => (form.fileWritePdfEnabled = value),
  'update:fileWritePdfMaxFileSizeMb': (value: number) => (form.fileWritePdfMaxFileSizeMb = value),
  'update:fileWriteCbxEnabled': (value: boolean) => (form.fileWriteCbxEnabled = value),
  'update:fileWriteCbxMaxFileSizeMb': (value: number) => (form.fileWriteCbxMaxFileSizeMb = value),
  'update:fileWriteAudioEnabled': (value: boolean) => (form.fileWriteAudioEnabled = value),
  'update:fileWriteAudioMaxFileSizeMb': (value: number) => (form.fileWriteAudioMaxFileSizeMb = value),
  'update:pickerOpen': handleNestedModalChange,
  prescan: creator.runPrescan,
}

useModal({
  container: panel,
  onClose: requestClose,
  disabled: () => nestedModalOpen.value || loading.value,
})

onMounted(async () => {
  try {
    if (props.library) {
      const response = await api(`/api/v1/libraries/${props.library.id}`)
      if (response.ok) creator.initEdit(await response.json())
      else {
        creator.initEdit(props.library)
        initializationWarning.value = 'The latest library settings could not be loaded. You can still edit the cached settings shown here.'
      }
      visitedUpTo.value = ALL_SECTIONS.length - 1
    } else {
      creator.initCreate()
      visitedUpTo.value = 0
    }
  } catch {
    if (props.library) {
      creator.initEdit(props.library)
      visitedUpTo.value = ALL_SECTIONS.length - 1
      initializationWarning.value = 'The latest library settings could not be loaded. You can still edit the cached settings shown here.'
    } else {
      creator.initCreate()
    }
  } finally {
    stepIndex.value = 0
    initialFormSnapshot.value = JSON.stringify(form)
    initializing.value = false
  }
})
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-70 flex items-end justify-center bg-foreground/25 sm:items-center sm:p-4"
      role="presentation"
      @click.self="requestClose"
    >
      <div
        ref="panel"
        class="flex h-[100dvh] w-full flex-col overflow-hidden border-border bg-background shadow-2xl outline-none sm:h-[min(92dvh,760px)] sm:max-w-4xl sm:rounded-xl sm:border"
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-creator-title"
        aria-describedby="library-creator-description"
        tabindex="-1"
      >
        <header class="shrink-0 border-b border-border bg-card px-4 py-3.5 sm:px-6 sm:py-4">
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <h2 id="library-creator-title" class="truncate font-serif text-lg font-semibold text-foreground sm:text-xl">{{ title }}</h2>
                <span v-if="isDirty" class="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {{ t('library.creator.unsaved') }}
                </span>
              </div>
              <p id="library-creator-description" class="mt-0.5 text-xs text-muted-foreground sm:text-sm">{{ activeSection.description }}</p>
            </div>
            <button
              type="button"
              class="-mr-1 flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
              :aria-label="t('library.creator.closeAria')"
              :disabled="loading"
              @click="requestClose"
            >
              <X :size="18" />
            </button>
          </div>
        </header>

        <div
          v-if="mode === 'create' && !props.library"
          class="h-1 shrink-0 bg-muted md:hidden"
          role="progressbar"
          :aria-label="t('library.creator.progressAria')"
          :aria-valuenow="stepIndex + 1"
          aria-valuemin="1"
          :aria-valuemax="sections.length"
        >
          <div class="h-full bg-primary transition-[width] duration-200" :style="{ width: progressWidth }" />
        </div>

        <div class="flex min-h-0 flex-1 flex-col md:flex-row">
          <nav
            class="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-muted/30 px-3 py-2 md:w-56 md:flex-col md:overflow-y-auto md:border-b-0 md:border-r md:px-3 md:py-4"
            :aria-label="t('library.creator.sectionsAria')"
          >
            <button
              v-for="(section, index) in sections"
              :key="section.id"
              type="button"
              class="relative flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors md:w-full md:gap-3 md:py-2.5 md:text-sm"
              :class="[
                stepIndex === index
                  ? 'bg-background font-medium text-foreground shadow-sm'
                  : mode === 'create' && index > visitedUpTo
                    ? 'cursor-not-allowed text-muted-foreground/50'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              ]"
              :disabled="mode === 'create' && index > visitedUpTo"
              :aria-current="stepIndex === index ? 'step' : undefined"
              @click="goTo(index)"
            >
              <span
                class="flex size-6 shrink-0 items-center justify-center rounded-md"
                :class="
                  sectionError(section.id)
                    ? 'bg-destructive/10 text-destructive'
                    : stepIndex === index
                      ? 'bg-primary/10 text-primary'
                      : 'bg-muted text-muted-foreground'
                "
              >
                <AlertCircle v-if="sectionError(section.id)" :size="13" />
                <Check v-else-if="mode === 'create' && index < stepIndex" :size="13" />
                <component :is="section.icon" v-else :size="13" />
              </span>
              <span class="whitespace-nowrap md:min-w-0 md:flex-1 md:whitespace-normal">{{ section.label }}</span>
              <span v-if="section.required" class="hidden text-[10px] text-muted-foreground md:block">{{ t('library.creator.required') }}</span>
            </button>
          </nav>

          <main class="min-w-0 flex-1 overflow-y-auto bg-background">
            <div v-if="initializing" class="flex h-full items-center justify-center text-muted-foreground">
              <Loader2 class="size-5 animate-spin" :aria-label="t('library.creator.loadingAria')" />
            </div>
            <template v-else>
              <div
                v-if="initializationWarning"
                class="mx-4 mt-4 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground sm:mx-6"
              >
                {{ initializationWarning }}
              </div>
              <component :is="ActiveComponent" v-bind="getSectionProps(activeId)" v-on="sectionListeners" />
            </template>
          </main>
        </div>

        <footer class="shrink-0 border-t border-border bg-card px-4 py-3 sm:px-6 sm:py-4">
          <div v-if="displayedError" class="mb-3 flex items-start gap-2 text-xs text-destructive" role="alert">
            <AlertCircle :size="14" class="mt-0.5 shrink-0" />
            <span>{{ displayedError }}</span>
          </div>

          <div v-if="initializing" class="flex h-9 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 class="size-4 animate-spin" />
            Loading settings...
          </div>

          <div v-else-if="mode === 'create'" class="flex items-center justify-between gap-3">
            <button
              type="button"
              class="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              @click="back"
            >
              <X v-if="isFirstStep" :size="14" />
              <ChevronLeft v-else :size="14" />
              {{ isFirstStep ? 'Cancel' : 'Back' }}
            </button>

            <span class="hidden text-xs tabular-nums text-muted-foreground sm:block">{{ stepIndex + 1 }} of {{ sections.length }}</span>

            <div class="flex items-center gap-2">
              <button
                v-if="stepIndex > 0 && !isLastStep"
                type="button"
                class="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="loading || !requiredSetupValid"
                @click="handleSave"
              >
                <span class="sm:hidden">{{ loading ? 'Creating...' : 'Create' }}</span>
                <span class="hidden sm:inline">{{ loading ? 'Creating...' : 'Create now' }}</span>
              </button>
              <button
                v-if="!isLastStep"
                type="button"
                class="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                @click="next"
              >
                Continue
                <ChevronRight :size="14" />
              </button>
              <button
                v-else
                type="button"
                class="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="loading"
                @click="handleSave"
              >
                {{ loading ? 'Creating...' : 'Create library' }}
              </button>
            </div>
          </div>

          <div v-else class="flex items-center justify-end gap-2">
            <button
              type="button"
              class="h-9 rounded-md border border-border px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
              :disabled="loading"
              @click="requestClose"
            >
              Cancel
            </button>
            <button
              type="button"
              class="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="loading || !isDirty"
              @click="handleSave"
            >
              {{ loading ? 'Saving...' : 'Save changes' }}
            </button>
          </div>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
