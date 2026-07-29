import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const clientRoot = fileURLToPath(new URL('..', import.meta.url))
const sourceDirectory = path.join(clientRoot, 'src')

/**
 * Text colours that resolve from a per-theme tuned token. Fading these with alpha
 * composites over the surface and bypasses the tuning: `--muted-foreground` is 0.52
 * lightness in light mode and 0.725 in dark, so the same alpha step lands at a very
 * different contrast ratio per theme and reliably fails AA in dark mode.
 *
 * Alpha on fills, borders, rings and shadows is fine. Only text is restricted.
 */
const TUNED_TEXT_TOKENS = [
  'foreground',
  'muted-foreground',
  'sidebar-foreground',
  'sidebar-accent-foreground',
  'card-foreground',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary-foreground',
  'accent-foreground',
  'destructive',
  'destructive-foreground',
]

// Matches `text-muted-foreground/70` including any Tailwind variant prefix
// (`hover:`, `placeholder:`, `group-data-[active=true]/item:` and so on).
const FADED_TEXT_PATTERN = new RegExp(String.raw`(?:[\w[\]=.\-/]+:)*text-(?:${TUNED_TEXT_TOKENS.join('|')})\/\d+`, 'g')

/**
 * Decorative, non-informational text that is deliberately near-invisible. Contrast
 * requirements do not apply because the text carries no meaning, so a tuned token
 * would be wrong here rather than merely dimmer.
 *
 * `text-white/*` and `text-black/*` are intentionally out of scope: they sit over book
 * covers, reader scrims and lightboxes rather than over a theme surface.
 */
const ALLOWED = new Map([['views/NotFoundView.vue', 'oversized decorative 404 numeral, carries no information']])

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(entryPath)
      return entry.isFile() && /\.(ts|vue)$/.test(entry.name) && !/\.(spec|test)\.ts$/.test(entry.name) ? [entryPath] : []
    }),
  )
  return files.flat()
}

const errors = []
const unusedAllowances = new Set(ALLOWED.keys())

for (const file of await sourceFiles(sourceDirectory)) {
  const relativePath = path.relative(sourceDirectory, file)
  const source = await readFile(file, 'utf8')
  const lines = source.split('\n')

  for (const [index, line] of lines.entries()) {
    for (const match of line.matchAll(FADED_TEXT_PATTERN)) {
      if (ALLOWED.has(relativePath)) {
        unusedAllowances.delete(relativePath)
        continue
      }
      errors.push(
        `${relativePath}:${index + 1}: ${match[0]} - fade-free text only. Use --foreground for interactive elements, --muted-foreground for secondary text, --primary for active state.`,
      )
    }
  }
}

for (const stalePath of unusedAllowances) {
  errors.push(`${stalePath}: listed in the validate-styles allowlist but no longer has faded text. Remove the entry.`)
}

if (errors.length > 0) {
  throw new Error(`Style validation failed:\n${errors.join('\n')}`)
}

console.log('Validated text colour tokens: no alpha-faded text')
