<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { X, ChevronLeft, ChevronRight, Check, Info, FolderOpen, ScanLine, Clock, Users, Tags, BookOpen, FileEdit } from 'lucide-vue-next'
import type { CoverAspectRatio, Library, OrganizationMode } from '@projectx/types'
import { api } from '@/lib/api'
import { useLibraryCreator } from '../composables/useLibraryCreator'
import LibraryCreatorDetails from './LibraryCreatorDetails.vue'
import LibraryCreatorFolders from './LibraryCreatorFolders.vue'
import LibraryCreatorScanner from './LibraryCreatorScanner.vue'
import LibraryCreatorSchedule from './LibraryCreatorSchedule.vue'
import LibraryCreatorAccess from './LibraryCreatorAccess.vue'
import LibraryCreatorMetadata from './LibraryCreatorMetadata.vue'
import LibraryCreatorReading from './LibraryCreatorReading.vue'
import LibraryCreatorFileWrite from './LibraryCreatorFileWrite.vue'

const props = defineProps<{
  library?: Library | null
}>()

const emit = defineEmits<{
  close: []
  saved: [library: Library]
}>()

const creator = useLibraryCreator()
const { form, mode, editingLibraryId, loading, prescanLoading, prescanResult, error } = creator

type SectionId = 'details' | 'folders' | 'scanner' | 'metadata' | 'fileWrite' | 'reading' | 'schedule' | 'access'

const ALL_SECTIONS: { id: SectionId; label: string; icon: unknown; component: unknown }[] = [
  { id: 'details', label: 'Details', icon: Info, component: LibraryCreatorDetails },
  { id: 'folders', label: 'Folders', icon: FolderOpen, component: LibraryCreatorFolders },
  { id: 'scanner', label: 'Scanner', icon: ScanLine, component: LibraryCreatorScanner },
  { id: 'metadata', label: 'Metadata', icon: Tags, component: LibraryCreatorMetadata },
  { id: 'fileWrite', label: 'File Write', icon: FileEdit, component: LibraryCreatorFileWrite },
  { id: 'reading', label: 'Reading', icon: BookOpen, component: LibraryCreatorReading },
  { id: 'schedule', label: 'Schedule', icon: Clock, component: LibraryCreatorSchedule },
  { id: 'access', label: 'Access', icon: Users, component: LibraryCreatorAccess },
]

// Access is only meaningful after a library exists
const sections = computed(() => (mode.value === 'create' ? ALL_SECTIONS.slice(0, 6) : ALL_SECTIONS))

// ── Stepper state ──────────────────────────────────────────────────────────

const stepIndex = ref(0)
const visitedUpTo = ref(0) // highest step reached in create mode

const activeSection = computed(() => sections.value[stepIndex.value])
const ActiveComponent = computed(() => activeSection.value?.component)
const activeId = computed(() => activeSection.value?.id ?? 'details')

const isFirstStep = computed(() => stepIndex.value === 0)
const isLastStep = computed(() => stepIndex.value === sections.value.length - 1)

function goTo(index: number) {
  if (index < 0 || index >= sections.value.length) return
  // In create mode, can only jump to visited steps (not ahead)
  if (mode.value === 'create' && index > visitedUpTo.value) return
  stepIndex.value = index
  mobileView.value = 'content'
}

function next() {
  if (isLastStep.value) return
  stepIndex.value++
  if (stepIndex.value > visitedUpTo.value) visitedUpTo.value = stepIndex.value
  mobileView.value = 'content'
}

function back() {
  if (isFirstStep.value) {
    emit('close')
    return
  }
  stepIndex.value--
  mobileView.value = 'content'
}

// ── Mobile ─────────────────────────────────────────────────────────────────

const mobileView = ref<'nav' | 'content'>('nav')

// ── Init ───────────────────────────────────────────────────────────────────

onMounted(async () => {
  if (props.library) {
    const res = await api(`/api/v1/libraries/${props.library.id}`)
    const full: Library = res.ok ? await res.json() : props.library
    creator.initEdit(full)
    visitedUpTo.value = ALL_SECTIONS.length - 1 // all unlocked in edit
  } else {
    creator.initCreate()
    visitedUpTo.value = 0
  }
  stepIndex.value = 0
  mobileView.value = mode.value === 'create' ? 'content' : 'nav'
})

// ── Save ───────────────────────────────────────────────────────────────────

async function handleSave() {
  const saved = await creator.save()
  if (saved) emit('saved', saved)
}

// ── Keyboard ───────────────────────────────────────────────────────────────

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))

// ── Section props / events ─────────────────────────────────────────────────

const title = computed(() => (props.library ? `Edit: ${props.library.name}` : 'Create Library'))

const stepValid = computed(() => {
  const id = activeId.value
  if (id === 'details') return form.name.trim().length > 0 && form.icon !== null
  if (id === 'folders') return form.folders.length > 0
  return true
})

const sectionProps = computed(() => ({
  details: { name: form.name, icon: form.icon, coverAspectRatio: form.coverAspectRatio },
  folders: { folders: form.folders, prescanResult: prescanResult.value, prescanLoading: prescanLoading.value },
  scanner: {
    organizationMode: form.organizationMode,
    allowedFormats: form.allowedFormats,
    excludePatterns: form.excludePatterns,
  },
  metadata: {
    metadataPrecedence: form.metadataPrecedence,
    formatPriority: form.formatPriority,
  },
  fileWrite: {
    fileWriteEnabled: form.fileWriteEnabled,
    fileWriteWriteCover: form.fileWriteWriteCover,
    fileWriteEpubEnabled: form.fileWriteEpubEnabled,
    fileWriteEpubMaxFileSizeMb: form.fileWriteEpubMaxFileSizeMb,
    fileWritePdfEnabled: form.fileWritePdfEnabled,
    fileWritePdfMaxFileSizeMb: form.fileWritePdfMaxFileSizeMb,
    fileWriteCbxEnabled: form.fileWriteCbxEnabled,
    fileWriteCbxMaxFileSizeMb: form.fileWriteCbxMaxFileSizeMb,
  },
  reading: {
    readingThreshold: form.readingThreshold,
    markAsFinishedPercentComplete: form.markAsFinishedPercentComplete,
  },
  schedule: { watch: form.watch, autoScanCronExpression: form.autoScanCronExpression },
  access: { libraryId: editingLibraryId.value },
}))

function getSectionProps(id: SectionId) {
  return sectionProps.value[id]
}

function onSectionEvent(id: SectionId, event: string, value: unknown) {
  if (event === 'update:name') form.name = value as string
  else if (event === 'update:icon') form.icon = value as string | null
  else if (event === 'update:coverAspectRatio') form.coverAspectRatio = value as CoverAspectRatio
  else if (event === 'update:folders') form.folders = value as string[]
  else if (event === 'prescan') creator.runPrescan()
  else if (event === 'update:organizationMode') form.organizationMode = value as OrganizationMode
  else if (event === 'update:metadataPrecedence') form.metadataPrecedence = value as string[]
  else if (event === 'update:formatPriority') form.formatPriority = value as string[]
  else if (event === 'update:allowedFormats') form.allowedFormats = value as string[]
  else if (event === 'update:excludePatterns') form.excludePatterns = value as string[]
  else if (event === 'update:readingThreshold') form.readingThreshold = value as number
  else if (event === 'update:markAsFinishedPercentComplete') form.markAsFinishedPercentComplete = value as number
  else if (event === 'update:watch') form.watch = value as boolean
  else if (event === 'update:autoScanCronExpression') form.autoScanCronExpression = value as string | null
  else if (event === 'update:fileWriteEnabled') form.fileWriteEnabled = value as boolean
  else if (event === 'update:fileWriteWriteCover') form.fileWriteWriteCover = value as boolean
  else if (event === 'update:fileWriteEpubEnabled') form.fileWriteEpubEnabled = value as boolean
  else if (event === 'update:fileWriteEpubMaxFileSizeMb') form.fileWriteEpubMaxFileSizeMb = value as number
  else if (event === 'update:fileWritePdfEnabled') form.fileWritePdfEnabled = value as boolean
  else if (event === 'update:fileWritePdfMaxFileSizeMb') form.fileWritePdfMaxFileSizeMb = value as number
  else if (event === 'update:fileWriteCbxEnabled') form.fileWriteCbxEnabled = value as boolean
  else if (event === 'update:fileWriteCbxMaxFileSizeMb') form.fileWriteCbxMaxFileSizeMb = value as number
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/50 backdrop-blur-[2px]" @click="emit('close')" />

      <div
        class="relative flex flex-col w-full max-w-3xl bg-background rounded-xl shadow-2xl overflow-hidden border border-border"
        style="height: min(90vh, 680px)"
      >
        <!-- ── MOBILE: Nav list (edit mode only — create goes straight to content) ── -->
        <Transition name="mobile-nav">
          <div v-if="mobileView === 'nav'" class="md:hidden absolute inset-0 flex flex-col bg-background z-10">
            <div class="flex items-center justify-between px-4 h-14 border-b border-border shrink-0">
              <span class="text-base font-semibold text-foreground font-serif">{{ title }}</span>
              <button
                class="flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                @click="emit('close')"
              >
                <X :size="16" />
              </button>
            </div>
            <div class="flex-1 overflow-y-auto">
              <button
                v-for="(section, i) in sections"
                :key="section.id"
                class="w-full flex items-center gap-3 px-4 py-4 border-b border-border/60 hover:bg-muted/50 transition-colors"
                @click="goTo(i)"
              >
                <div class="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 shrink-0">
                  <component :is="section.icon" :size="15" class="text-primary" />
                </div>
                <span class="flex-1 text-sm font-medium text-foreground text-left">{{ section.label }}</span>
              </button>
            </div>
            <div class="px-4 py-4 border-t border-border flex gap-3 justify-end">
              <button
                class="px-4 py-2 rounded-md border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                @click="emit('close')"
              >
                Cancel
              </button>
              <button
                class="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                :disabled="loading"
                @click="handleSave"
              >
                {{ loading ? 'Saving…' : 'Save changes' }}
              </button>
            </div>
          </div>
        </Transition>

        <!-- ── MOBILE: Content ───────────────────────── -->
        <Transition name="mobile-content">
          <div v-if="mobileView === 'content'" class="md:hidden absolute inset-0 flex flex-col bg-background z-10">
            <div class="flex items-center gap-1 px-2 h-14 border-b border-border shrink-0">
              <button
                v-if="mode === 'edit'"
                class="flex items-center gap-1 px-2 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                @click="mobileView = 'nav'"
              >
                <ChevronLeft :size="18" />
                <span class="text-sm">Back</span>
              </button>
              <span class="flex-1 text-sm font-medium text-foreground text-center" :class="mode === 'edit' ? 'pr-16' : ''">
                {{ activeSection?.label }}
              </span>
              <button
                v-if="mode === 'create'"
                class="flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors ml-auto"
                @click="emit('close')"
              >
                <X :size="16" />
              </button>
            </div>
            <div class="flex-1 overflow-y-auto">
              <component
                :is="ActiveComponent"
                v-bind="getSectionProps(activeId)"
                @update:name="onSectionEvent(activeId, 'update:name', $event)"
                @update:icon="onSectionEvent(activeId, 'update:icon', $event)"
                @update:folders="onSectionEvent(activeId, 'update:folders', $event)"
                @prescan="onSectionEvent(activeId, 'prescan', null)"
                @update:organizationMode="onSectionEvent(activeId, 'update:organizationMode', $event)"
                @update:metadataPrecedence="onSectionEvent(activeId, 'update:metadataPrecedence', $event)"
                @update:formatPriority="onSectionEvent(activeId, 'update:formatPriority', $event)"
                @update:allowedFormats="onSectionEvent(activeId, 'update:allowedFormats', $event)"
                @update:excludePatterns="onSectionEvent(activeId, 'update:excludePatterns', $event)"
                @update:coverAspectRatio="onSectionEvent(activeId, 'update:coverAspectRatio', $event)"
                @update:readingThreshold="onSectionEvent(activeId, 'update:readingThreshold', $event)"
                @update:markAsFinishedPercentComplete="onSectionEvent(activeId, 'update:markAsFinishedPercentComplete', $event)"
                @update:watch="onSectionEvent(activeId, 'update:watch', $event)"
                @update:autoScanCronExpression="onSectionEvent(activeId, 'update:autoScanCronExpression', $event)"
                @update:fileWriteEnabled="onSectionEvent(activeId, 'update:fileWriteEnabled', $event)"
                @update:fileWriteWriteCover="onSectionEvent(activeId, 'update:fileWriteWriteCover', $event)"
                @update:fileWriteEpubEnabled="onSectionEvent(activeId, 'update:fileWriteEpubEnabled', $event)"
                @update:fileWriteEpubMaxFileSizeMb="onSectionEvent(activeId, 'update:fileWriteEpubMaxFileSizeMb', $event)"
                @update:fileWritePdfEnabled="onSectionEvent(activeId, 'update:fileWritePdfEnabled', $event)"
                @update:fileWritePdfMaxFileSizeMb="onSectionEvent(activeId, 'update:fileWritePdfMaxFileSizeMb', $event)"
                @update:fileWriteCbxEnabled="onSectionEvent(activeId, 'update:fileWriteCbxEnabled', $event)"
                @update:fileWriteCbxMaxFileSizeMb="onSectionEvent(activeId, 'update:fileWriteCbxMaxFileSizeMb', $event)"
              />
            </div>
            <div class="shrink-0 px-4 py-4 border-t border-border">
              <p v-if="error" class="text-xs text-destructive mb-3">{{ error }}</p>
              <div class="flex gap-3" :class="mode === 'create' ? 'justify-between' : 'justify-end'">
                <!-- Create mode: Back / Next or Create -->
                <template v-if="mode === 'create'">
                  <button
                    class="flex items-center gap-1.5 px-4 py-2 rounded-md border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    @click="back"
                  >
                    <X v-if="isFirstStep" :size="14" />
                    <ChevronLeft v-else :size="14" />
                    {{ isFirstStep ? 'Cancel' : 'Back' }}
                  </button>
                  <button
                    v-if="!isLastStep"
                    class="flex items-center gap-1.5 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                    :disabled="!stepValid"
                    @click="next"
                  >
                    Next
                    <ChevronRight :size="14" />
                  </button>
                  <button
                    v-else
                    class="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                    :disabled="loading"
                    @click="handleSave"
                  >
                    {{ loading ? 'Creating…' : 'Create library' }}
                  </button>
                </template>
                <!-- Edit mode: Cancel / Save -->
                <template v-else>
                  <button
                    class="flex items-center gap-1.5 px-4 py-2 rounded-md border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    @click="emit('close')"
                  >
                    <X :size="14" />
                    Cancel
                  </button>
                  <button
                    class="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                    :disabled="loading"
                    @click="handleSave"
                  >
                    {{ loading ? 'Saving…' : 'Save changes' }}
                  </button>
                </template>
              </div>
            </div>
          </div>
        </Transition>

        <!-- ── DESKTOP: Two-column ───────────────────── -->
        <div class="hidden md:flex flex-1 min-h-0">
          <!-- Left sidebar -->
          <nav class="flex flex-col w-48 shrink-0 bg-muted/40 border-r border-border">
            <div class="px-4 pt-5 pb-4 border-b border-border flex items-center justify-between shrink-0">
              <span class="text-sm font-semibold text-foreground font-serif truncate">{{ title }}</span>
              <button
                class="flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0 ml-1"
                @click="emit('close')"
              >
                <X :size="14" />
              </button>
            </div>

            <div class="flex-1 overflow-y-auto py-3 px-2">
              <button
                v-for="(section, i) in sections"
                :key="section.id"
                class="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors relative"
                :class="[
                  stepIndex === i
                    ? 'bg-background text-foreground font-medium shadow-sm'
                    : mode === 'create' && i > visitedUpTo
                      ? 'text-muted-foreground/60 cursor-not-allowed'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/60 cursor-pointer',
                ]"
                :disabled="mode === 'create' && i > visitedUpTo"
                @click="goTo(i)"
              >
                <!-- Step indicator: number / check / icon -->
                <span
                  v-if="mode === 'create'"
                  class="flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold shrink-0 transition-colors"
                  :class="
                    i < stepIndex
                      ? 'bg-primary text-primary-foreground'
                      : stepIndex === i
                        ? 'bg-primary/15 text-primary ring-1 ring-primary'
                        : 'bg-muted-foreground/15 text-muted-foreground/60'
                  "
                >
                  <Check v-if="i < stepIndex" :size="10" />
                  <template v-else>{{ i + 1 }}</template>
                </span>
                <component v-else :is="section.icon" :size="14" :class="stepIndex === i ? 'text-primary' : 'text-muted-foreground/85'" />

                {{ section.label }}
                <div v-if="stepIndex === i" class="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r bg-primary" />
              </button>
            </div>
          </nav>

          <!-- Right content -->
          <div class="flex flex-col flex-1 min-w-0">
            <div class="flex-1 overflow-y-auto">
              <component
                :is="ActiveComponent"
                v-bind="getSectionProps(activeId)"
                @update:name="onSectionEvent(activeId, 'update:name', $event)"
                @update:icon="onSectionEvent(activeId, 'update:icon', $event)"
                @update:folders="onSectionEvent(activeId, 'update:folders', $event)"
                @prescan="onSectionEvent(activeId, 'prescan', null)"
                @update:organizationMode="onSectionEvent(activeId, 'update:organizationMode', $event)"
                @update:metadataPrecedence="onSectionEvent(activeId, 'update:metadataPrecedence', $event)"
                @update:formatPriority="onSectionEvent(activeId, 'update:formatPriority', $event)"
                @update:allowedFormats="onSectionEvent(activeId, 'update:allowedFormats', $event)"
                @update:excludePatterns="onSectionEvent(activeId, 'update:excludePatterns', $event)"
                @update:coverAspectRatio="onSectionEvent(activeId, 'update:coverAspectRatio', $event)"
                @update:readingThreshold="onSectionEvent(activeId, 'update:readingThreshold', $event)"
                @update:markAsFinishedPercentComplete="onSectionEvent(activeId, 'update:markAsFinishedPercentComplete', $event)"
                @update:watch="onSectionEvent(activeId, 'update:watch', $event)"
                @update:autoScanCronExpression="onSectionEvent(activeId, 'update:autoScanCronExpression', $event)"
                @update:fileWriteEnabled="onSectionEvent(activeId, 'update:fileWriteEnabled', $event)"
                @update:fileWriteWriteCover="onSectionEvent(activeId, 'update:fileWriteWriteCover', $event)"
                @update:fileWriteEpubEnabled="onSectionEvent(activeId, 'update:fileWriteEpubEnabled', $event)"
                @update:fileWriteEpubMaxFileSizeMb="onSectionEvent(activeId, 'update:fileWriteEpubMaxFileSizeMb', $event)"
                @update:fileWritePdfEnabled="onSectionEvent(activeId, 'update:fileWritePdfEnabled', $event)"
                @update:fileWritePdfMaxFileSizeMb="onSectionEvent(activeId, 'update:fileWritePdfMaxFileSizeMb', $event)"
                @update:fileWriteCbxEnabled="onSectionEvent(activeId, 'update:fileWriteCbxEnabled', $event)"
                @update:fileWriteCbxMaxFileSizeMb="onSectionEvent(activeId, 'update:fileWriteCbxMaxFileSizeMb', $event)"
              />
            </div>

            <!-- Footer -->
            <div class="shrink-0 border-t border-border px-6 py-4">
              <p v-if="error" class="text-xs text-destructive mb-3">{{ error }}</p>

              <!-- Create mode: stepper nav -->
              <div v-if="mode === 'create'" class="flex items-center justify-between">
                <button
                  class="flex items-center gap-1.5 px-4 py-2 rounded-md border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  @click="back"
                >
                  <X v-if="isFirstStep" :size="14" />
                  <ChevronLeft v-else :size="14" />
                  {{ isFirstStep ? 'Cancel' : 'Back' }}
                </button>

                <span class="text-xs text-muted-foreground"> Step {{ stepIndex + 1 }} of {{ sections.length }} </span>

                <button
                  v-if="!isLastStep"
                  class="flex items-center gap-1.5 px-5 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                  :disabled="!stepValid"
                  @click="next"
                >
                  Next
                  <ChevronRight :size="14" />
                </button>
                <button
                  v-else
                  class="px-5 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                  :disabled="loading"
                  @click="handleSave"
                >
                  {{ loading ? 'Creating…' : 'Create library' }}
                </button>
              </div>

              <!-- Edit mode: cancel + save -->
              <div v-else class="flex items-center justify-end gap-3">
                <button
                  class="flex items-center gap-1.5 px-4 py-2 rounded-md border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  @click="emit('close')"
                >
                  <X :size="14" />
                  Cancel
                </button>
                <button
                  class="px-5 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                  :disabled="loading"
                  @click="handleSave"
                >
                  {{ loading ? 'Saving…' : 'Save changes' }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.mobile-nav-enter-active,
.mobile-nav-leave-active,
.mobile-content-enter-active,
.mobile-content-leave-active {
  transition:
    transform 0.2s ease,
    opacity 0.15s ease;
}
.mobile-nav-enter-from {
  transform: translateX(-100%);
}
.mobile-nav-leave-to {
  transform: translateX(-100%);
}
.mobile-content-enter-from {
  transform: translateX(100%);
}
.mobile-content-leave-to {
  transform: translateX(100%);
}
</style>
