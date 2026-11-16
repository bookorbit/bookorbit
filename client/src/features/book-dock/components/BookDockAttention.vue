<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Files, FolderSearch, FolderX, Inbox, Loader2, Power, Settings, Trash2, TriangleAlert } from '@lucide/vue'
import type { LibraryDocksAdmin } from '@bookorbit/types'
import { formatNumber } from '@/i18n/formatters'
import { adoptLibraryDockFolder, moveLibraryDockFolderToUnsorted, removeLibraryDockFolder, type DockActionResult } from '../api/book-dock.api'

const props = defineProps<{ admin: LibraryDocksAdmin }>()

const emit = defineEmits<{ changed: [] }>()

const { t } = useI18n()

/** The folder an action is running on, so its buttons show progress and cannot be pressed twice. */
const busyFolder = ref<string | null>(null)
const failure = ref<string | null>(null)

const libraryNames = computed(() => new Map(props.admin.libraries.map((entry) => [entry.libraryId, entry.libraryName])))

const folders = computed(() =>
  props.admin.unrecognisedFolders.map((folder) => ({
    ...folder,
    libraryName: folder.matchesLibraryId == null ? null : (libraryNames.value.get(folder.matchesLibraryId) ?? null),
  })),
)

const strayCount = computed(() => props.admin.strayFiles.length)
const rowCount = computed(() => folders.value.length + (strayCount.value > 0 ? 1 : 0))

async function run(folderName: string, action: () => Promise<DockActionResult<unknown>>) {
  if (busyFolder.value) return
  busyFolder.value = folderName
  failure.value = null
  const result = await action()
  busyFolder.value = null
  if (result.ok) {
    emit('changed')
    return
  }
  failure.value =
    result.errorCode === 'LIBRARY_DOCK_FOLDER_NOT_EMPTY' ? t('bookDock.attention.notEmpty', { folder: folderName }) : t('bookDock.attention.failed')
}

function adopt(folder: { name: string; matchesLibraryId: number | null }) {
  const libraryId = folder.matchesLibraryId
  if (libraryId == null) return
  void run(folder.name, () => adoptLibraryDockFolder(folder.name, libraryId))
}

function moveToUnsorted(folder: { name: string }) {
  void run(folder.name, () => moveLibraryDockFolderToUnsorted(folder.name))
}

function remove(folder: { name: string }) {
  void run(folder.name, () => removeLibraryDockFolder(folder.name))
}
</script>

<template>
  <section
    v-if="rowCount > 0"
    data-testid="book-dock-attention"
    aria-labelledby="book-dock-attention-heading"
    class="overflow-hidden rounded-xl border border-border bg-card"
  >
    <div class="flex h-10 items-center gap-2 border-b border-border bg-muted/35 px-3">
      <TriangleAlert class="size-3.5 text-amber-500" aria-hidden="true" />
      <h2 id="book-dock-attention-heading" class="text-xs font-semibold tracking-wider whitespace-nowrap text-foreground uppercase">
        {{ t('bookDock.attention.title') }}
      </h2>
      <span
        class="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500/16 px-1.5 text-[11.5px] font-semibold tabular-nums text-amber-600 dark:text-amber-400"
      >
        {{ formatNumber(rowCount) }}
      </span>
      <RouterLink
        :to="{ name: 'settings-admin-book-dock' }"
        :aria-label="t('bookDock.facts.dockSettings')"
        class="ms-auto inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-foreground transition-colors hover:bg-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Settings class="size-[13px] text-muted-foreground" aria-hidden="true" />
        <span class="hidden sm:inline">{{ t('bookDock.facts.dockSettings') }}</span>
      </RouterLink>
    </div>

    <ul>
      <li v-for="folder in folders" :key="folder.name" class="attention-row border-t border-border first:border-t-0">
        <span
          class="grid size-7 place-items-center rounded-[7px]"
          :class="folder.libraryName ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : 'bg-red-500/15 text-red-700 dark:text-red-300'"
        >
          <FolderSearch v-if="folder.libraryName" class="size-[15px]" aria-hidden="true" />
          <FolderX v-else class="size-[15px]" aria-hidden="true" />
        </span>
        <span class="min-w-0 truncate font-mono text-[12.5px] font-semibold text-foreground">_libraries/{{ folder.name }}</span>
        <span class="attention-why text-[12.5px] text-muted-foreground">
          {{ folder.libraryName ? t('bookDock.attention.matches', { library: folder.libraryName }) : t('bookDock.attention.unowned') }}
        </span>
        <span class="attention-actions flex flex-wrap items-center gap-1.5">
          <button
            v-if="folder.libraryName"
            type="button"
            :data-testid="`book-dock-attention-adopt-${folder.name}`"
            class="inline-flex h-7 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-[11.5px] font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            :disabled="busyFolder !== null"
            @click="adopt(folder)"
          >
            <Loader2 v-if="busyFolder === folder.name" class="size-3 animate-spin" aria-hidden="true" />
            <Power v-else class="size-3" aria-hidden="true" />
            {{ t('bookDock.attention.turnOn', { library: folder.libraryName }) }}
          </button>
          <template v-else>
            <button
              type="button"
              :data-testid="`book-dock-attention-move-${folder.name}`"
              class="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[11.5px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              :disabled="busyFolder !== null"
              @click="moveToUnsorted(folder)"
            >
              <Loader2 v-if="busyFolder === folder.name" class="size-3 animate-spin" aria-hidden="true" />
              <Inbox v-else class="size-3" aria-hidden="true" />
              {{ t('bookDock.attention.moveToUnsorted') }}
            </button>
            <button
              type="button"
              :data-testid="`book-dock-attention-remove-${folder.name}`"
              class="inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] font-medium text-red-600 transition-colors hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 dark:text-red-400"
              :disabled="busyFolder !== null"
              :title="t('bookDock.attention.removeHint')"
              @click="remove(folder)"
            >
              <Trash2 class="size-3" aria-hidden="true" />
              {{ t('bookDock.attention.remove') }}
            </button>
          </template>
        </span>
      </li>
      <li v-if="strayCount > 0" class="attention-row border-t border-border first:border-t-0">
        <span class="grid size-7 place-items-center rounded-[7px] bg-violet-500/15 text-violet-700 dark:text-violet-300">
          <Files class="size-[15px]" aria-hidden="true" />
        </span>
        <span class="min-w-0 truncate font-mono text-[12.5px] font-semibold text-foreground">_libraries</span>
        <span class="attention-why text-[12.5px] text-muted-foreground">
          <span class="me-1.5 font-semibold text-foreground tabular-nums">{{
            props.admin.strayFilesTruncated
              ? t('bookDock.attention.manyFiles', { count: strayCount })
              : t('bookDock.attention.files', { count: strayCount })
          }}</span>
          {{ t('bookDock.attention.loose') }}
        </span>
        <span />
      </li>
    </ul>
    <p v-if="failure" role="alert" class="border-t border-border px-3 py-2 text-xs text-red-600 dark:text-red-400">{{ failure }}</p>
  </section>
</template>

<style scoped>
.attention-row {
  display: grid;
  grid-template-columns: 28px minmax(0, 15rem) minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  padding-block: 6px;
  padding-inline: 12px 10px;
}

@media (max-width: 640px) {
  .attention-row {
    grid-template-columns: 28px minmax(0, 1fr);
    gap: 4px 10px;
    padding: 10px 12px;
  }
  .attention-why,
  .attention-actions {
    grid-column: 2;
  }
}
</style>
