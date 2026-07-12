export function normalizeFolderPath(path: string): string {
  const trimmed = path.trim() || '/'
  if (trimmed === '/') return '/'
  return trimmed.replace(/\/+$/, '')
}

export function coveringFolderPath(path: string, candidates: string[]): string | null {
  const normalized = normalizeFolderPath(path)
  return (
    candidates
      .map(normalizeFolderPath)
      .filter((candidate) => candidate !== normalized && isPathInside(normalized, candidate))
      .sort((a, b) => b.length - a.length)[0] ?? null
  )
}

export function consolidateFolderPaths(paths: string[]): string[] {
  const unique = [...new Set(paths.map(normalizeFolderPath))].sort((a, b) => a.length - b.length || a.localeCompare(b))
  return unique.filter((path, index) => !unique.slice(0, index).some((candidate) => isPathInside(path, candidate)))
}

function isPathInside(path: string, parent: string): boolean {
  return parent === '/' ? path.startsWith('/') : path.startsWith(`${parent}/`)
}
