import { ref, type Ref } from 'vue'
import type { OrganizationMode } from '@bookorbit/types'
import { normalizeFolderPath } from '../folder-paths'
import { folderStatus, isInside, leafName, rangeBetween, toggleFolder, type FolderStatus, type PickerLibrary } from './folder-picker-rules'
import type { FolderPickerData } from './useFolderPickerData'

/** A message for the footer, translated where it is shown. */
export interface PickerNotice {
  key: string
  params?: Record<string, string | number>
}

interface SelectionOptions {
  data: FolderPickerData
  own: () => string[]
  others: () => PickerLibrary[]
  appDataPath: () => string | null
  mode: Ref<OrganizationMode>
  onModeChange: (mode: OrganizationMode) => void
}

export function useFolderPickerSelection(options: SelectionOptions) {
  const selected = ref<string[]>([])
  const notice = ref<PickerNotice | null>(null)
  const undo = ref<{ selected: string[]; mode: OrganizationMode; notice: PickerNotice } | null>(null)
  const lastTick = ref<string | null>(null)

  function isDenied(path: string): boolean {
    const key = normalizeFolderPath(path)
    const state = options.data.listings.get(key)?.state ?? options.data.summaries.get(key)?.state
    return state === 'denied'
  }

  function isAppData(path: string): boolean {
    const appData = options.appDataPath()
    const key = normalizeFolderPath(path)
    return !!appData && (key === normalizeFolderPath(appData) || isInside(key, appData))
  }

  function status(path: string): FolderStatus | null {
    return folderStatus(path, {
      denied: isDenied(path),
      appData: isAppData(path),
      own: options.own(),
      selected: selected.value,
      others: options.others(),
    })
  }

  function blockedNotice(path: string, current: FolderStatus): PickerNotice {
    const name = leafName(path)
    if (current.kind === 'denied') return { key: 'library.folderBrowser.reason.denied' }
    if (current.kind === 'appData') return { key: 'library.folderBrowser.reason.appData' }
    if (current.kind === 'own') return { key: 'library.folderBrowser.reason.own', params: { name } }
    if (current.kind === 'ownCovered') return { key: 'library.folderBrowser.reason.ownCovered', params: { path: current.cover ?? '' } }
    return { key: 'library.folderBrowser.reason.included', params: { path: current.cover ?? '' } }
  }

  function toggle(path: string) {
    const current = status(path)
    undo.value = null
    if (current?.block) {
      notice.value = blockedNotice(path, current)
      return
    }
    const result = toggleFolder(selected.value, path)
    selected.value = result.selected
    lastTick.value = normalizeFolderPath(path)
    notice.value = result.folded.length
      ? {
          key: 'library.folderBrowser.notice.folded',
          params: { path: normalizeFolderPath(path), count: result.folded.length, name: leafName(result.folded[0]!) },
        }
      : null
  }

  /** Shift-click: tick every sibling from the last ticked folder to this one. */
  function tickRange(path: string, siblings: string[]) {
    const run = lastTick.value ? rangeBetween(siblings, lastTick.value, normalizeFolderPath(path)) : []
    if (run.length === 0) return toggle(path)
    undo.value = null
    let ticked = 0
    for (const folder of run) {
      if (selected.value.includes(folder) || status(folder)?.block) continue
      selected.value = toggleFolder(selected.value, folder).selected
      ticked += 1
    }
    lastTick.value = normalizeFolderPath(path)
    notice.value = ticked
      ? { key: 'library.folderBrowser.notice.range', params: { count: ticked, from: leafName(run[0]!), to: leafName(run[run.length - 1]!) } }
      : null
  }

  function snapshot(next: PickerNotice) {
    undo.value = { selected: [...selected.value], mode: options.mode.value, notice: next }
    notice.value = null
  }

  function remove(path: string) {
    snapshot({ key: 'library.folderBrowser.notice.removed', params: { name: leafName(path) } })
    selected.value = selected.value.filter((folder) => folder !== normalizeFolderPath(path))
  }

  function setMode(mode: OrganizationMode) {
    if (options.mode.value === mode) return
    snapshot({ key: mode === 'book_per_file' ? 'library.folderBrowser.notice.modeFile' : 'library.folderBrowser.notice.modeFolder' })
    options.mode.value = mode
    options.onModeChange(mode)
  }

  let leaving = false

  /** Swaps a picked folder for the folders inside it, leaving out whatever another library reads. */
  async function leaveOut(path: string) {
    if (leaving) return
    leaving = true
    try {
      const others = options.others()
      const readByOther = (folder: string) => others.some((library) => library.folders.some((own) => normalizeFolderPath(own) === folder))
      const holdsOther = (folder: string) => others.some((library) => library.folders.some((own) => isInside(own, folder)))
      const keep: string[] = []
      const walk = async (folder: string) => {
        const listing = await options.data.ensureListing(folder)
        const children = (listing?.entries ?? []).filter((entry) => !entry.system && !entry.appData).map((entry) => normalizeFolderPath(entry.path))
        const counts = await options.data.summariesFor(children)
        for (const child of children) {
          if (readByOther(child) || isDenied(child)) continue
          if (holdsOther(child)) await walk(child)
          // A folder whose count could not be had is kept: dropping it could lose books.
          else if ((counts.get(child)?.files ?? 1) > 0) keep.push(child)
        }
      }
      const key = normalizeFolderPath(path)
      await walk(key)
      if (!selected.value.includes(key)) return
      snapshot({ key: 'library.folderBrowser.notice.leftOut', params: { name: leafName(key), count: keep.length } })
      selected.value = [...new Set([...selected.value.filter((folder) => folder !== key), ...keep])].sort()
    } finally {
      leaving = false
    }
  }

  function restore() {
    if (!undo.value) return
    selected.value = undo.value.selected
    if (undo.value.mode !== options.mode.value) {
      options.mode.value = undo.value.mode
      options.onModeChange(undo.value.mode)
    }
    undo.value = null
    notice.value = null
  }

  return { selected, notice, undo, lastTick, status, toggle, tickRange, remove, setMode, leaveOut, restore }
}

export type FolderPickerSelection = ReturnType<typeof useFolderPickerSelection>
