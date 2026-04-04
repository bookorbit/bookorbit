<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { X, Loader2, FolderPlus } from 'lucide-vue-next'
import { api } from '@/lib/api'
import { useLibraries } from '@/features/library/composables/useLibraries'

const props = defineProps<{
  selectionPayload: { fileIds?: number[]; selectAll?: boolean; excludedIds?: number[]; status?: string; search?: string }
  selectionCount: number
}>()

const emit = defineEmits<{
  close: []
  updated: []
}>()

const { libraries, fetchLibraries } = useLibraries()
const loading = ref(false)
const error = ref<string | null>(null)
const result = ref<{ total: number; updated: number; failed: number } | null>(null)

const targetLibraryId = ref<number | null>(null)
const targetFolderId = ref<number | null>(null)

const selectedLibrary = computed(() => libraries.value.find((l) => l.id === targetLibraryId.value))
const folders = computed(() => selectedLibrary.value?.folders ?? [])
const canApply = computed(() => targetLibraryId.value !== null && targetFolderId.value !== null && !loading.value)

onMounted(async () => {
  await fetchLibraries()
  const first = libraries.value[0]
  if (!first) return
  targetLibraryId.value = first.id
  targetFolderId.value = first.folders?.[0]?.id ?? null
})

function onLibraryChange(event: Event) {
  const raw = Number((event.target as HTMLSelectElement).value)
  const id = Number.isFinite(raw) && raw > 0 ? raw : null
  if (id === null) {
    targetLibraryId.value = null
    targetFolderId.value = null
    return
  }
  targetLibraryId.value = id
  const lib = libraries.value.find((l) => l.id === id)
  targetFolderId.value = lib?.folders?.[0]?.id ?? null
}

function onFolderChange(event: Event) {
  const raw = Number((event.target as HTMLSelectElement).value)
  targetFolderId.value = Number.isFinite(raw) && raw > 0 ? raw : null
}

async function applyDestination() {
  if (!canApply.value) return
  loading.value = true
  error.value = null
  try {
    const res = await api('/api/v1/book-bucket/files/set-target', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...props.selectionPayload,
        targetLibraryId: targetLibraryId.value,
        targetFolderId: targetFolderId.value,
      }),
    })
    if (res.ok) {
      result.value = await res.json()
    } else {
      const body = await res.json().catch(() => null)
      error.value = (body as { message?: string } | null)?.message ?? `Error ${res.status}`
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to set destination'
  } finally {
    loading.value = false
  }
}

function handleClose() {
  if (result.value) emit('updated')
  else emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="handleClose" />
      <div class="relative z-10 w-full max-w-xl mx-4 bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
        <div class="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 class="text-base font-semibold text-foreground">
            {{ result ? 'Destination Updated' : `Set Destination for ${selectionCount} file${selectionCount === 1 ? '' : 's'}` }}
          </h2>
          <button
            class="size-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
            @click="handleClose"
          >
            <X class="size-4" />
          </button>
        </div>

        <div v-if="!result" class="px-5 py-4 space-y-4">
          <label class="block">
            <span class="text-xs font-medium text-muted-foreground">Destination Library</span>
            <select
              class="mt-1 w-full h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
              :value="targetLibraryId ?? ''"
              @change="onLibraryChange"
            >
              <option v-for="lib in libraries" :key="lib.id" :value="lib.id">{{ lib.name }}</option>
            </select>
          </label>

          <label class="block">
            <span class="text-xs font-medium text-muted-foreground">Destination Folder</span>
            <select
              class="mt-1 w-full h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
              :value="targetFolderId ?? ''"
              @change="onFolderChange"
            >
              <option v-for="folder in folders" :key="folder.id" :value="folder.id">{{ folder.path }}</option>
            </select>
          </label>

          <p v-if="error" class="text-xs text-red-500 bg-red-500/10 rounded-lg p-2">{{ error }}</p>

          <div class="flex items-center justify-end gap-2 pt-1">
            <button class="h-8 px-4 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-all" @click="handleClose">
              Cancel
            </button>
            <button
              class="flex items-center gap-1.5 h-8 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium transition-all hover:opacity-90 active:scale-95 disabled:opacity-50"
              :disabled="!canApply"
              @click="applyDestination"
            >
              <Loader2 v-if="loading" class="size-3.5 animate-spin" />
              <FolderPlus v-else class="size-3.5" />
              Apply
            </button>
          </div>
        </div>

        <div v-else class="px-5 py-4 space-y-4">
          <div class="rounded-lg bg-emerald-500/10 p-3">
            <p class="text-sm font-medium">Updated {{ result.updated }} of {{ result.total }} files</p>
            <p v-if="result.failed > 0" class="text-xs text-muted-foreground mt-0.5">{{ result.failed }} failed</p>
          </div>
          <div class="flex justify-end">
            <button
              class="h-8 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium transition-all hover:opacity-90 active:scale-95"
              @click="handleClose"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
