import { ref } from 'vue'

const STORAGE_KEY = 'cover-versions'

function loadFromStorage(): Map<number, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Map()
    return new Map(JSON.parse(raw) as [number, number][])
  } catch {
    return new Map()
  }
}

function saveToStorage(map: Map<number, number>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...map]))
  } catch {
    // ignore quota errors
  }
}

const versions = ref<Map<number, number>>(loadFromStorage())

export function useCoverVersions() {
  function bumpVersion(bookId: number) {
    const next = new Map(versions.value).set(bookId, Date.now())
    versions.value = next
    saveToStorage(next)
  }

  function getVersion(bookId: number): number | undefined {
    return versions.value.get(bookId)
  }

  return { getVersion, bumpVersion }
}
