import { MAX_PATH_SEGMENT_BYTES, resolveDownloadFilename, resolvePlaceholders, resolveUploadPath, type OrganizationMode } from '@bookorbit/types'
import { patternLevels, type PatternLevelKind } from './pattern-levels'
import type { NamingTarget } from './naming-rules'

/**
 * One row of the resolved path. The names come from the real resolver so sanitization, the
 * extension and the 255-byte limit are exactly what an upload gets; each level is also resolved
 * on its own only to learn whether it dropped out or fell back.
 */
export interface ResolvedLevel {
  kind: PatternLevelKind
  text: string
  name: string
  bookFolder: boolean
  /** The level resolved to nothing and is left out of the path. */
  skipped: boolean
  /** A required folder that resolved to nothing, leaving an empty name in the path. */
  emptyName: boolean
  usedFallback: boolean
  /** A pattern ending in a slash keeps the uploaded file's own name. */
  keepsUploadName: boolean
  truncated: boolean
}

export interface ResolvedPreview {
  path: string
  levels: ResolvedLevel[]
}

export interface ResolveOptions {
  target: NamingTarget
  mode: OrganizationMode | null
  extension: string
  sanitize: boolean
}

const TRUNCATION_MARK = /~[0-9a-f]{8}(\.[^.]+)?$/

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

function wasTruncated(name: string): boolean {
  return byteLength(name) >= MAX_PATH_SEGMENT_BYTES - 16 && TRUNCATION_MARK.test(name)
}

export function resolvePreview(pattern: string, metadata: Record<string, string>, options: ResolveOptions): ResolvedPreview {
  const resolverOptions = { sanitizeForCrossPlatform: options.sanitize }

  if (options.target === 'download') {
    const name = resolveDownloadFilename(pattern, metadata, options.extension, resolverOptions) ?? ''
    const { usedFallback } = resolvePlaceholders(pattern || '{originalFilename}', metadata)
    return {
      path: name,
      levels: [
        {
          kind: 'file',
          text: pattern,
          name,
          bookFolder: false,
          skipped: !name,
          emptyName: false,
          usedFallback,
          keepsUploadName: false,
          truncated: wasTruncated(name),
        },
      ],
    }
  }

  const path = pattern.trim() ? (resolveUploadPath(pattern, metadata, options.extension, resolverOptions) ?? '') : ''
  const segments = path ? path.split('/') : []
  let cursor = 0

  const levels = patternLevels(pattern, options.mode, options.target).map((level): ResolvedLevel => {
    const own = resolvePlaceholders(level.text, metadata)
    const keepsUploadName = level.kind === 'file' && !level.text.trim()
    const empty = level.kind === 'file' ? !own.text : !own.text.replace(/\/$/, '').trim()
    const skipped = empty && !keepsUploadName
    // An unguarded required folder still leaves its slash, and so an empty segment, behind.
    const emptyName = skipped && level.kind === 'folder'
    if (emptyName) cursor += 1
    const name = skipped ? '' : (segments[cursor++] ?? '')
    return {
      kind: level.kind,
      text: level.text,
      name,
      bookFolder: level.bookFolder,
      skipped,
      emptyName,
      usedFallback: own.usedFallback,
      keepsUploadName,
      truncated: wasTruncated(name),
    }
  })

  return { path, levels }
}

export interface LevelChange {
  kind: PatternLevelKind
  bookFolder: boolean
  from: string
  to: string
  skipped: boolean
  /** The folder is still created, but with no name: an unguarded token came out empty. */
  emptyName: boolean
  usedFallback: boolean
}

/** What a missing field changes, level by level, against the complete result. */
export function levelChanges(base: ResolvedPreview, other: ResolvedPreview): LevelChange[] {
  const changes: LevelChange[] = []
  base.levels.forEach((level, index) => {
    const next = other.levels[index]
    if (!next) return
    const nowEmpty = !level.emptyName && next.emptyName
    const nowSkipped = !level.skipped && next.skipped && !nowEmpty
    if (!nowSkipped && !nowEmpty && level.name === next.name) return
    changes.push({
      kind: level.kind,
      bookFolder: level.bookFolder,
      from: level.name,
      to: next.name,
      skipped: nowSkipped,
      emptyName: nowEmpty,
      usedFallback: next.usedFallback && !level.usedFallback,
    })
  })
  return changes
}

/** Splits "01. Neuromancer (1984).epub" so the extension can be drawn apart from the name. */
export function splitExtension(name: string, extension: string): [string, string] {
  const suffix = extension ? `.${extension}` : ''
  if (!suffix || !name.toLowerCase().endsWith(suffix.toLowerCase())) return [name, '']
  return [name.slice(0, -suffix.length), name.slice(-suffix.length)]
}

/** The first token a level reads, so a skipped folder can say which value was missing. */
export function firstToken(text: string): string | null {
  const match = text.match(/\{([A-Za-z]+)/)
  return match?.[1] ?? null
}
