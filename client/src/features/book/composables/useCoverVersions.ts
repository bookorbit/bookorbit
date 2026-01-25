import { ref } from 'vue'

const versions = ref<Map<number, number>>(new Map())

export function useCoverVersions() {
  function bumpVersion(bookId: number) {
    versions.value = new Map(versions.value).set(bookId, Date.now())
  }

  function getVersion(bookId: number): number | undefined {
    return versions.value.get(bookId)
  }

  return { getVersion, bumpVersion }
}
