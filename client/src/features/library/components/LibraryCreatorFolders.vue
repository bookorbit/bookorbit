<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, Trash2, RefreshCw, FolderOpen, AlertTriangle, CheckCircle2, XCircle, Loader2 } from '@lucide/vue'
import type { PrescanResult } from '@bookorbit/types'
import { api } from '@/lib/api'
import FolderPickerModal from './FolderPickerModal.vue'

const { t } = useI18n()

const props = defineProps<{
  folders: string[]
  prescanResult: PrescanResult | null
  prescanLoading: boolean
}>()

const emit = defineEmits<{
  'update:folders': [value: string[]]
  prescan: []
}>()

const pickerOpen = ref(false)
const manualPath = ref('')
const testLoading = ref(false)
const testResult = ref<'ok' | 'error' | null>(null)

function onFolderSelected(path: string) {
  pickerOpen.value = false
  if (!path || props.folders.includes(path)) return
  emit('update:folders', [...props.folders, path])
}

function removeFolder(index: number) {
  const updated = [...props.folders]
  updated.splice(index, 1)
  emit('update:folders', updated)
}

function prescanStatusFor(path: string) {
  return props.prescanResult?.paths.find((p) => p.path === path) ?? null
}

function onManualInput() {
  testResult.value = null
}

async function testPath() {
  const trimmed = manualPath.value.trim()
  if (!trimmed) return
  testLoading.value = true
  testResult.value = null
  try {
    const res = await api('/api/v1/libraries/prescan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: [trimmed] }),
    })
    if (res.ok) {
      const data: PrescanResult = await res.json()
      testResult.value = data.paths[0]?.accessible ? 'ok' : 'error'
    } else {
      testResult.value = 'error'
    }
  } catch {
    testResult.value = 'error'
  } finally {
    testLoading.value = false
  }
}

function addManual() {
  const trimmed = manualPath.value.trim()
  if (!trimmed || props.folders.includes(trimmed)) return
  emit('update:folders', [...props.folders, trimmed])
  manualPath.value = ''
  testResult.value = null
}

function onManualKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    addManual()
  }
}
</script>

<template>
  <div class="px-6 py-6 space-y-6">
    <div>
      <p class="text-[11px] font-semibold uppercase tracking-widest text-foreground/80 mb-1">{{ t('library.creator.folders.title') }}</p>
      <p class="text-xs text-muted-foreground mb-3">{{ t('library.creator.folders.description') }}</p>

      <!-- Browse button -->
      <button
        class="flex items-center gap-2 w-full rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground hover:text-foreground hover:border-primary/50 hover:bg-muted/40 transition-colors"
        @click="pickerOpen = true"
      >
        <Plus :size="15" class="shrink-0" />
        {{ t('library.creator.folders.browseAdd') }}
      </button>

      <!-- Manual entry -->
      <div class="mt-3">
        <p class="text-xs text-muted-foreground mb-2">{{ t('library.creator.folders.manualEntry') }}</p>
        <div class="flex gap-2">
          <div class="relative flex-1">
            <input
              v-model="manualPath"
              type="text"
              :placeholder="t('library.creator.folders.pathPlaceholder')"
              class="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground font-mono placeholder:text-muted-foreground/60 placeholder:font-sans focus:outline-none focus:ring-2 focus:ring-ring transition-colors"
              :class="testResult === 'ok' ? 'border-emerald-500' : testResult === 'error' ? 'border-destructive' : 'border-border'"
              @input="onManualInput"
              @keydown="onManualKeydown"
            />
            <span v-if="testResult === 'ok'" class="absolute right-2.5 top-1/2 -translate-y-1/2">
              <CheckCircle2 :size="14" class="text-emerald-500" />
            </span>
            <span v-else-if="testResult === 'error'" class="absolute right-2.5 top-1/2 -translate-y-1/2">
              <XCircle :size="14" class="text-destructive" />
            </span>
          </div>
          <button
            class="flex items-center gap-1.5 px-3 py-2 rounded-md border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0 disabled:opacity-50"
            :disabled="!manualPath.trim() || testLoading"
            @click="testPath"
          >
            <Loader2 v-if="testLoading" :size="12" class="animate-spin" />
            {{ t('library.creator.folders.test') }}
          </button>
          <button
            class="flex items-center gap-1.5 px-3 py-2 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity shrink-0 disabled:opacity-50"
            :disabled="!manualPath.trim()"
            @click="addManual"
          >
            <Plus :size="12" />
            {{ t('library.creator.folders.add') }}
          </button>
        </div>
        <p v-if="testResult === 'error'" class="mt-1.5 text-xs text-destructive">{{ t('library.creator.folders.pathNotAccessible') }}</p>
        <p v-else-if="testResult === 'ok'" class="mt-1.5 text-xs text-emerald-600 dark:text-emerald-400">
          {{ t('library.creator.folders.pathAccessible') }}
        </p>
      </div>

      <!-- Folder list -->
      <div class="mt-4 space-y-2">
        <div v-for="(folder, index) in folders" :key="folder" class="rounded-lg border border-border bg-card px-4 py-3">
          <div class="flex items-center gap-3">
            <FolderOpen :size="15" class="text-muted-foreground shrink-0 mt-0.5" />
            <span class="flex-1 text-xs text-foreground font-mono break-all">{{ folder }}</span>
            <button
              class="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
              @click="removeFolder(index)"
            >
              <Trash2 :size="13" />
            </button>
          </div>

          <!-- Prescan result for this path -->
          <div v-if="prescanStatusFor(folder)" class="mt-2 ml-6">
            <div v-if="!prescanStatusFor(folder)!.accessible" class="flex items-center gap-1.5 text-xs text-destructive">
              <XCircle :size="12" />
              {{ t('library.creator.folders.pathNotAccessibleShort') }}
            </div>
            <div v-else class="flex items-center gap-3 text-xs text-muted-foreground">
              <span class="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 :size="12" />
                {{ t('library.creator.folders.bookFilesFound', { count: prescanStatusFor(folder)!.fileCount }, prescanStatusFor(folder)!.fileCount) }}
              </span>
              <span v-if="prescanStatusFor(folder)!.overlapLibrary" class="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                <AlertTriangle :size="12" />
                {{ t('library.creator.folders.overlapsWith', { library: prescanStatusFor(folder)!.overlapLibrary }) }}
              </span>
            </div>
          </div>
        </div>

        <div v-if="folders.length === 0" class="rounded-lg border border-dashed border-border px-4 py-6 text-center">
          <FolderOpen :size="22" class="text-muted-foreground/60 mx-auto mb-2" />
          <p class="text-xs text-muted-foreground">{{ t('library.creator.folders.noneAdded') }}</p>
        </div>
      </div>

      <!-- Prescan button -->
      <div class="flex items-center justify-between mt-4 pt-4 border-t border-border">
        <div v-if="prescanResult" class="text-xs text-muted-foreground">
          {{ t('library.creator.folders.totalFilesFound', { count: prescanResult.totalFiles }, prescanResult.totalFiles) }}
        </div>
        <div v-else class="text-xs text-muted-foreground">{{ t('library.creator.folders.runPrescanHint') }}</div>
        <button
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          :disabled="folders.length === 0 || prescanLoading"
          @click="emit('prescan')"
        >
          <RefreshCw :size="12" :class="prescanLoading ? 'animate-spin' : ''" />
          {{ prescanLoading ? t('library.creator.folders.scanning') : t('library.creator.folders.prescan') }}
        </button>
      </div>
    </div>
  </div>

  <FolderPickerModal v-if="pickerOpen" @select="onFolderSelected" @close="pickerOpen = false" />
</template>
