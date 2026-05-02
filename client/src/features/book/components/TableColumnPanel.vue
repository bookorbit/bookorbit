<script setup lang="ts">
import { ref } from 'vue'
import { Copy, Download, RotateCcw, Star, Upload, X } from 'lucide-vue-next'
import type { TableDensity } from '@/composables/useDisplaySettings'
import type { SavedView } from '@/features/book/composables/useSavedViews'
import type { ColumnDef, ColumnId } from '@/features/book/composables/useTableColumns'
import type { TablePreset } from '@/features/book/composables/useTablePresets'

const props = withDefaults(
  defineProps<{
    allColumns: (ColumnDef & { visible: boolean })[]
    allPresets: TablePreset[]
    savedViews?: SavedView[]
    tableDensity?: TableDensity
  }>(),
  {
    savedViews: () => [],
    tableDensity: 'comfortable',
  },
)

const emit = defineEmits<{
  'toggle-column': [id: ColumnId]
  'reorder-columns': [cols: (ColumnDef & { visible: boolean })[]]
  'apply-preset': [preset: TablePreset]
  'save-preset': [name: string]
  'delete-preset': [id: string]
  'rename-preset': [id: string, name: string]
  'duplicate-preset': [id: string]
  'favorite-preset': [id: string]
  'apply-view': [view: SavedView]
  'save-view': [name: string]
  'delete-view': [id: string]
  'rename-view': [id: string, name: string]
  'duplicate-view': [id: string]
  'favorite-view': [id: string]
  'update:density': [density: TableDensity]
  'export-backup': []
  'import-backup': [file: File]
  reset: []
}>()

const presetName = ref('')
const viewName = ref('')
const importInputRef = ref<HTMLInputElement | null>(null)

function handleSavePreset() {
  const name = presetName.value.trim()
  if (!name) return
  emit('save-preset', name)
  presetName.value = ''
}

function handleSaveView() {
  const name = viewName.value.trim()
  if (!name) return
  emit('save-view', name)
  viewName.value = ''
}

function promptForRename(currentName: string): string | null {
  if (typeof window === 'undefined') return null
  const nextName = window.prompt('Enter a new name', currentName)
  return nextName ? nextName.trim() : null
}

function handleRenamePreset(preset: TablePreset) {
  const nextName = promptForRename(preset.name)
  if (!nextName) return
  emit('rename-preset', preset.id, nextName)
}

function handleRenameView(view: SavedView) {
  const nextName = promptForRename(view.name)
  if (!nextName) return
  emit('rename-view', view.id, nextName)
}

function handleImportBackupClick() {
  importInputRef.value?.click()
}

function handleImportBackup(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  emit('import-backup', file)
  input.value = ''
}

function densityButtonClass(density: TableDensity) {
  return props.tableDensity === density
    ? 'border-primary bg-primary/10 text-primary'
    : 'border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
}

function pinBadge(column: ColumnDef & { visible: boolean }): string | null {
  if (column.pinned === 'left') return 'Pinned left'
  if (column.pinned === 'right') return 'Pinned right'
  return null
}

function columnLabel(column: ColumnDef & { visible: boolean }): string {
  if (column.header) return column.header
  if (column.id === 'cover') return 'Cover'
  return column.id === 'actions' ? 'Actions' : column.id
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center justify-between">
      <span class="text-xs font-semibold uppercase tracking-wide text-foreground">Columns</span>
      <button class="text-xs text-muted-foreground hover:text-foreground" @click="emit('reset')">
        <RotateCcw :size="11" class="mr-0.5 inline" />Reset
      </button>
    </div>

    <div class="space-y-2 rounded-md border border-border/60 p-2">
      <div class="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Table density</div>
      <div class="grid grid-cols-3 gap-1">
        <button
          class="h-8 rounded-md border text-xs transition-colors"
          :class="densityButtonClass('compact')"
          @click="emit('update:density', 'compact')"
        >
          Compact
        </button>
        <button
          class="h-8 rounded-md border text-xs transition-colors"
          :class="densityButtonClass('comfortable')"
          @click="emit('update:density', 'comfortable')"
        >
          Comfortable
        </button>
        <button class="h-8 rounded-md border text-xs transition-colors" :class="densityButtonClass('roomy')" @click="emit('update:density', 'roomy')">
          Roomy
        </button>
      </div>
    </div>

    <div class="space-y-2 rounded-md border border-border/60 p-2">
      <div class="flex items-center justify-between gap-2">
        <div class="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Presets</div>
        <div class="flex items-center gap-1">
          <button
            class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Export presets and saved views"
            @click="emit('export-backup')"
          >
            <Download :size="12" />
          </button>
          <button
            class="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Import presets and saved views"
            @click="handleImportBackupClick"
          >
            <Upload :size="12" />
          </button>
        </div>
      </div>
      <input ref="importInputRef" type="file" accept="application/json" class="hidden" @change="handleImportBackup" />
      <div class="space-y-1">
        <div
          v-for="preset in allPresets"
          :key="preset.id"
          class="flex items-center gap-2 rounded px-2 py-1 text-xs transition-colors hover:bg-accent"
        >
          <button class="min-w-0 flex-1 text-left" @click="emit('apply-preset', preset)">
            <span class="truncate">{{ preset.name }}</span>
          </button>
          <button
            v-if="!preset.isBuiltIn"
            class="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
            :class="preset.favorite ? 'text-primary' : ''"
            @click="emit('favorite-preset', preset.id)"
          >
            <Star :size="11" :class="preset.favorite ? 'fill-current' : ''" />
          </button>
          <button
            v-if="!preset.isBuiltIn"
            class="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
            @click="emit('duplicate-preset', preset.id)"
          >
            <Copy :size="11" />
          </button>
          <button
            v-if="!preset.isBuiltIn"
            class="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
            @click="handleRenamePreset(preset)"
          >
            Rename
          </button>
          <span v-if="preset.isBuiltIn" class="text-[10px] text-muted-foreground">Built in</span>
          <button
            v-if="!preset.isBuiltIn"
            class="rounded p-1 text-muted-foreground hover:bg-background hover:text-destructive"
            @click="emit('delete-preset', preset.id)"
          >
            <X :size="11" />
          </button>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <input
          v-model="presetName"
          class="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground"
          placeholder="Save current preset"
        />
        <button
          class="h-8 shrink-0 rounded-md border border-input px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          @click="handleSavePreset"
        >
          Save
        </button>
      </div>
    </div>

    <div class="space-y-2 rounded-md border border-border/60 p-2">
      <div class="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Saved views</div>
      <div v-if="savedViews.length > 0" class="space-y-1">
        <div v-for="view in savedViews" :key="view.id" class="flex items-center gap-2 rounded px-2 py-1 text-xs transition-colors hover:bg-accent">
          <button class="min-w-0 flex-1 text-left" @click="emit('apply-view', view)">
            <span class="truncate">{{ view.name }}</span>
          </button>
          <button
            class="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
            :class="view.favorite ? 'text-primary' : ''"
            @click="emit('favorite-view', view.id)"
          >
            <Star :size="11" :class="view.favorite ? 'fill-current' : ''" />
          </button>
          <button class="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground" @click="emit('duplicate-view', view.id)">
            <Copy :size="11" />
          </button>
          <button class="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground" @click="handleRenameView(view)">Rename</button>
          <button class="rounded p-1 text-muted-foreground hover:bg-background hover:text-destructive" @click="emit('delete-view', view.id)">
            <X :size="11" />
          </button>
        </div>
      </div>
      <p v-else class="text-xs text-muted-foreground">Save sort, layout, and view-specific filters for quick reuse.</p>
      <div class="flex items-center gap-2">
        <input
          v-model="viewName"
          class="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground"
          placeholder="Save current view"
        />
        <button
          class="h-8 shrink-0 rounded-md border border-input px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          @click="handleSaveView"
        >
          Save
        </button>
      </div>
    </div>

    <div class="space-y-1 rounded-md border border-border/60 p-2">
      <label v-for="col in allColumns" :key="col.id" class="flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-accent">
        <input type="checkbox" :checked="col.visible" class="accent-primary" @change="emit('toggle-column', col.id)" />
        <span class="flex-1">{{ columnLabel(col) }}</span>
        <span v-if="pinBadge(col)" class="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">{{ pinBadge(col) }}</span>
      </label>
    </div>
  </div>
</template>
