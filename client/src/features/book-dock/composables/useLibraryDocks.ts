import { computed, ref } from 'vue'
import type { BookDockUploadTarget, LibraryDockAdminEntry, LibraryDockFiling, LibraryDocksAdmin } from '@bookorbit/types'

import { checkLibraryDockFiling, fetchDockUploadTargets, fetchLibraryDocksAdmin } from '../api/book-dock.api'

/** A library dock as the dock page shows it. Managers also get the dock's settings entry. */
export interface LibraryDockView {
  dockId: number
  libraryId: number
  libraryName: string
  enabled: boolean
  /** Formats the library takes; empty takes every supported format. Unknown for a dock that is off. */
  allowedFormats: string[]
  entry: LibraryDockAdminEntry | null
}

const uploadTargets = ref<BookDockUploadTarget[]>([])
const admin = ref<LibraryDocksAdmin | null>(null)
const filing = ref<Map<number, LibraryDockFiling>>(new Map())
const loaded = ref(false)

const docks = computed<LibraryDockView[]>(() => {
  const formatsByDock = new Map(uploadTargets.value.map((target) => [target.dockId, target.allowedFormats]))
  const views: LibraryDockView[] = admin.value
    ? admin.value.libraries.flatMap((entry) =>
        entry.dock
          ? [
              {
                dockId: entry.dock.id,
                libraryId: entry.libraryId,
                libraryName: entry.libraryName,
                enabled: entry.dock.enabled,
                allowedFormats: formatsByDock.get(entry.dock.id) ?? [],
                entry,
              },
            ]
          : [],
      )
    : uploadTargets.value.map((target) => ({ ...target, enabled: true, entry: null }))
  return views.sort((a, b) => a.libraryName.localeCompare(b.libraryName))
})

/**
 * The library docks this person can see, shared across the dock page and its upload button.
 * Managers read every dock with its settings; everyone else, the docks they can upload into.
 */
export function useLibraryDocks() {
  async function refreshDocks(manager: boolean): Promise<void> {
    const [targets, adminData] = await Promise.all([fetchDockUploadTargets(), manager ? fetchLibraryDocksAdmin() : Promise.resolve(null)])
    uploadTargets.value = targets
    admin.value = adminData
    loaded.value = true
  }

  /** Probes each library's filing once per call; managers only. */
  async function refreshFiling(): Promise<void> {
    const checks = await checkLibraryDockFiling()
    filing.value = new Map(checks.map((check) => [check.libraryId, check.filing]))
  }

  function dockById(dockId: number): LibraryDockView | undefined {
    return docks.value.find((dock) => dock.dockId === dockId)
  }

  function uploadTargetFor(dockId: number): BookDockUploadTarget | undefined {
    return uploadTargets.value.find((target) => target.dockId === dockId)
  }

  return { docks, admin, uploadTargets, filing, loaded, refreshDocks, refreshFiling, dockById, uploadTargetFor }
}
