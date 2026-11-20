<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Copy, FolderPen, GitMerge, Inbox, Library, Link, MoveRight, Pencil, Sprout, TriangleAlert } from '@lucide/vue'
import type { BookDockSettings, LibraryDockAdminEntry, LibraryDockFiling } from '@bookorbit/types'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'

const props = defineProps<{
  libraries: LibraryDockAdminEntry[]
  settings: BookDockSettings
  filing: Map<number, LibraryDockFiling>
  /** The library whose dock is being turned on or off. */
  busyLibraryId: number | null
}>()

const emit = defineEmits<{
  edit: [number]
  editUnsorted: []
  toggle: [LibraryDockAdminEntry, boolean]
}>()

const { t } = useI18n()

/** Libraries with a dock first, then the rest, each by name. */
const rows = computed(() => [...props.libraries].sort((a, b) => Number(!a.dock) - Number(!b.dock) || a.libraryName.localeCompare(b.libraryName)))

function filingPill(entry: LibraryDockAdminEntry) {
  const filing = props.filing.get(entry.libraryId)
  if (!filing || filing === 'unknown') return null
  if (filing === 'copy')
    return {
      label: t('settings.reader.bookDock.docks.filingCopy'),
      icon: Copy,
      class: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
      hint: t('bookDock.facts.copiesHint'),
    }
  if (entry.dock?.keepOriginal)
    return { label: t('settings.reader.bookDock.docks.filingHardlink'), icon: Link, class: 'bg-sky-500/15 text-sky-700 dark:text-sky-300', hint: '' }
  return { label: t('settings.reader.bookDock.docks.filingMove'), icon: MoveRight, class: 'bg-muted text-muted-foreground', hint: '' }
}

function autoFile(entry: LibraryDockAdminEntry): { label: string; inherited: boolean; off: boolean } {
  const overrides = entry.dock?.overrides
  const inherited = overrides?.autoFinalizeEnabled == null && overrides?.autoFinalizeThreshold == null
  if (!entry.effective.autoFinalizeEnabled) return { label: t('settings.reader.bookDock.docks.off'), inherited, off: true }
  return { label: `${entry.effective.autoFinalizeThreshold}%`, inherited, off: false }
}

const unsortedAutoFile = computed(() =>
  props.settings.autoFinalizeEnabled ? `${props.settings.autoFinalizeThreshold}%` : t('settings.reader.bookDock.docks.off'),
)

function onToggle(entry: LibraryDockAdminEntry, enabled: boolean) {
  emit('toggle', entry, enabled)
}

function onEdit(entry: LibraryDockAdminEntry) {
  emit('edit', entry.libraryId)
}

function onEditUnsorted() {
  emit('editUnsorted')
}
</script>

<template>
  <div class="settings-card overflow-hidden">
    <table class="docks-table w-full border-collapse text-[13px]" data-testid="library-docks-table">
      <thead>
        <tr class="text-start text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          <th scope="col" class="ps-4 pe-3 py-2.5 text-start font-semibold">{{ t('settings.reader.bookDock.docks.columnLibrary') }}</th>
          <th scope="col" class="col-wide px-3 py-2.5 text-start font-semibold">{{ t('settings.reader.bookDock.docks.columnAutoFile') }}</th>
          <th scope="col" class="col-wide px-3 py-2.5 text-start font-semibold">{{ t('settings.reader.bookDock.docks.columnFiling') }}</th>
          <th scope="col" class="col-wide px-3 py-2.5 text-start font-semibold">{{ t('settings.reader.bookDock.docks.columnExtras') }}</th>
          <th scope="col" class="ps-3 pe-4 py-2.5 text-end font-semibold">{{ t('settings.reader.bookDock.docks.columnOn') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr data-testid="library-docks-row-unsorted" class="border-t border-border">
          <td class="ps-4 pe-3 py-2.5">
            <span class="flex items-center gap-1.5 font-medium text-foreground">
              <Inbox class="size-3.5 text-muted-foreground" aria-hidden="true" />
              {{ t('bookDock.switcher.unsorted') }}
            </span>
            <span class="mt-0.5 block truncate text-xs text-muted-foreground">{{ t('settings.reader.bookDock.docks.unsortedHint') }}</span>
          </td>
          <td class="col-wide px-3 py-2.5">
            <span class="tabular-nums" :class="props.settings.autoFinalizeEnabled ? 'text-foreground' : 'text-muted-foreground'">{{
              unsortedAutoFile
            }}</span>
          </td>
          <td class="col-wide px-3 py-2.5" />
          <td class="col-wide px-3 py-2.5">
            <span class="flex flex-wrap gap-1">
              <span v-if="props.settings.unsortedKeepOriginal" class="pill bg-violet-500/15 text-violet-700 dark:text-violet-300">
                <Sprout class="size-3" aria-hidden="true" />{{ t('bookDock.facts.keepsOriginals') }}
              </span>
              <span v-if="props.settings.unsortedAutoJoin" class="pill bg-teal-500/15 text-teal-700 dark:text-teal-300">
                <GitMerge class="size-3" aria-hidden="true" />{{ t('settings.reader.bookDock.docks.joinsBooks') }}
              </span>
              <span v-if="!props.settings.unsortedKeepOriginal && !props.settings.unsortedAutoJoin" class="text-muted-foreground">{{
                t('settings.reader.bookDock.docks.none')
              }}</span>
            </span>
          </td>
          <td class="ps-3 pe-4 py-2.5">
            <span class="flex items-center justify-end gap-2">
              <ToggleSwitch
                :model-value="true"
                disabled
                :aria-label="t('settings.reader.bookDock.docks.unsortedAlwaysOn')"
                :title="t('settings.reader.bookDock.docks.unsortedAlwaysOn')"
              />
              <button
                type="button"
                data-testid="library-docks-edit-unsorted"
                class="grid size-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                :aria-label="t('settings.reader.bookDock.docks.editDock', { dock: t('bookDock.switcher.unsorted') })"
                @click="onEditUnsorted"
              >
                <Pencil class="size-3.5" aria-hidden="true" />
              </button>
            </span>
          </td>
        </tr>

        <tr v-for="entry in rows" :key="entry.libraryId" :data-testid="`library-docks-row-${entry.libraryId}`" class="border-t border-border">
          <td class="ps-4 pe-3 py-2.5">
            <span class="flex items-center gap-1.5 font-medium" :class="entry.dock ? 'text-foreground' : 'text-muted-foreground'">
              <Library class="size-3.5 text-muted-foreground" aria-hidden="true" />
              {{ entry.libraryName }}
            </span>
            <span class="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              <template v-if="entry.dock">
                <span class="truncate font-mono">_libraries/{{ entry.dock.folderName }}</span>
                <span
                  v-if="entry.suggestedFolderName"
                  class="inline-flex items-center gap-1 font-medium text-amber-600 dark:text-amber-400"
                  :title="t('settings.reader.bookDock.docks.oldNameHint')"
                >
                  <FolderPen class="size-3" aria-hidden="true" />{{ t('settings.reader.bookDock.docks.oldName') }}
                </span>
                <span v-if="entry.dock.targetFolderId === null" class="inline-flex items-center gap-1 font-medium text-amber-600 dark:text-amber-400">
                  <TriangleAlert class="size-3" aria-hidden="true" />{{ t('settings.reader.bookDock.docks.noFolder') }}
                </span>
              </template>
              <span v-else>{{ t('settings.reader.bookDock.docks.noDock') }}</span>
            </span>
          </td>
          <td class="col-wide px-3 py-2.5">
            <template v-if="entry.dock">
              <span class="inline-flex items-center gap-1.5" :class="autoFile(entry).off ? 'text-muted-foreground' : 'text-foreground'">
                <span class="tabular-nums">{{ autoFile(entry).label }}</span>
                <span v-if="autoFile(entry).inherited" class="rounded-sm bg-muted px-1 text-[10.5px] font-medium text-muted-foreground">{{
                  t('settings.reader.bookDock.docks.default')
                }}</span>
              </span>
            </template>
          </td>
          <td class="col-wide px-3 py-2.5">
            <span v-if="entry.dock && filingPill(entry)" class="pill" :class="filingPill(entry)?.class" :title="filingPill(entry)?.hint || undefined">
              <component :is="filingPill(entry)?.icon" class="size-3" aria-hidden="true" />{{ filingPill(entry)?.label }}
            </span>
          </td>
          <td class="col-wide px-3 py-2.5">
            <span v-if="entry.dock" class="flex flex-wrap gap-1">
              <span v-if="entry.dock.keepOriginal" class="pill bg-violet-500/15 text-violet-700 dark:text-violet-300">
                <Sprout class="size-3" aria-hidden="true" />{{ t('bookDock.facts.keepsOriginals') }}
              </span>
              <span v-if="entry.dock.autoJoin" class="pill bg-teal-500/15 text-teal-700 dark:text-teal-300">
                <GitMerge class="size-3" aria-hidden="true" />{{ t('settings.reader.bookDock.docks.joinsBooks') }}
              </span>
              <span v-if="!entry.dock.keepOriginal && !entry.dock.autoJoin" class="text-muted-foreground">{{
                t('settings.reader.bookDock.docks.none')
              }}</span>
            </span>
          </td>
          <td class="ps-3 pe-4 py-2.5">
            <span class="flex items-center justify-end gap-2">
              <ToggleSwitch
                :model-value="entry.dock?.enabled ?? false"
                :disabled="props.busyLibraryId !== null"
                :aria-label="t('settings.reader.bookDock.docks.dockOn', { library: entry.libraryName })"
                :data-testid="`library-docks-toggle-${entry.libraryId}`"
                @update:model-value="onToggle(entry, $event)"
              />
              <button
                v-if="entry.dock"
                type="button"
                :data-testid="`library-docks-edit-${entry.libraryId}`"
                class="grid size-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                :aria-label="t('settings.reader.bookDock.docks.editDock', { dock: entry.libraryName })"
                @click="onEdit(entry)"
              >
                <Pencil class="size-3.5" aria-hidden="true" />
              </button>
              <span v-else class="size-7" aria-hidden="true" />
            </span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding-inline: 8px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 500;
  white-space: nowrap;
}

/* On a phone the table keeps the library and its switch; the detail is in the edit panel. */
@media (max-width: 640px) {
  .docks-table .col-wide {
    display: none;
  }
}
</style>
