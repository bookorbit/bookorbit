import { LUCIDE_ICON_ALIASES, LUCIDE_ICON_FILES, LUCIDE_VERSION } from 'virtual:lucide-icon-index'
import { guessLucideFileName } from './lucide-icon-name'

const ICON_FILES = new Set(LUCIDE_ICON_FILES)
const ICON_FOLDER = `${import.meta.env.BASE_URL}assets/lucide/${LUCIDE_VERSION}/`

function* nameCandidates(name: string): Generator<string> {
  yield name
  if (name.endsWith('Icon')) yield name.slice(0, -'Icon'.length)
  if (name.startsWith('Lucide')) yield name.slice('Lucide'.length)
}

/**
 * The icon file for a stored Lucide component name (`FolderOpen`, a renamed alias such as
 * `AlertTriangle`, or the `…Icon` and `Lucide…` export forms), or null when it names no icon.
 * Stored values stay PascalCase component names: released iOS builds read and write them.
 */
export function resolveLucideIconFile(name: string | null | undefined): string | null {
  if (!name || !/^[A-Z]/.test(name)) return null
  for (const candidate of nameCandidates(name)) {
    const file = LUCIDE_ICON_ALIASES[candidate] ?? guessLucideFileName(candidate)
    if (ICON_FILES.has(file)) return file
  }
  return null
}

/** One icon's own file: what a page that shows a few stored icons downloads. */
export function lucideIconHref(file: string): string {
  return `${ICON_FOLDER}${file}.svg#${file}`
}

/** The file holding every icon, for the picker, which shows hundreds at once. */
export function lucideCatalogHref(file: string): string {
  return `${ICON_FOLDER}catalog.svg#${file}`
}
