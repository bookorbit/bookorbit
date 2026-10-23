import type { FontScope, FontStyle, FontUploadErrorCode } from '@bookorbit/types'
import { FONT_UPLOAD_ERROR_CODES } from '@bookorbit/types'
import { FontUploadError } from '@/features/reader/epub/composables/useCustomFonts'

/** Where one dropped file ended up. */
export type UploadState = 'queued' | 'uploading' | 'added' | 'duplicate' | 'refused' | 'failed'

export interface UploadFace {
  familyName: string
  weight: number
  style: FontStyle
}

export interface UploadOutcome {
  state: Exclude<UploadState, 'queued' | 'uploading'>
  /** The face the file became, or the face already on the server that it duplicates. */
  face: UploadFace | null
  code: FontUploadErrorCode | null
  meta: Record<string, string | number>
}

const isUploadCode = (code: unknown): code is FontUploadErrorCode => (FONT_UPLOAD_ERROR_CODES as readonly unknown[]).includes(code)

function faceFromMeta(meta: Record<string, string | number> | undefined): UploadFace | null {
  if (!meta || typeof meta.familyName !== 'string') return null
  const weight = typeof meta.weight === 'number' ? meta.weight : 400
  return { familyName: meta.familyName, weight, style: meta.style === 'italic' ? 'italic' : 'normal' }
}

/**
 * Reads a refused upload. Servers older than the error codes send only an English message, and a
 * file over the multipart limit is cut off by the HTTP layer with a bare 413; both still land in a
 * state the tray can describe.
 */
export function outcomeOfError(err: unknown): UploadOutcome {
  if (!(err instanceof FontUploadError)) return { state: 'failed', face: null, code: null, meta: {} }
  const meta = err.meta ?? {}
  const code = isUploadCode(err.code) ? err.code : err.status === 413 ? 'FONT_TOO_LARGE' : null
  if (code === 'FONT_DUPLICATE') return { state: 'duplicate', face: faceFromMeta(meta), code, meta }
  if (code) return { state: 'refused', face: faceFromMeta(meta), code, meta }
  return { state: 'failed', face: null, code: null, meta }
}

/** Translation key for a refusal's reason. The cap reads differently for a reader's own collection. */
export function refusalMessageKey(code: FontUploadErrorCode | null, scope: FontScope = 'server'): string {
  switch (code) {
    case 'FONT_TOO_LARGE':
      return 'settings.admin.serverFonts.upload.reasons.tooLarge'
    case 'FONT_UNSUPPORTED_TYPE':
      return 'settings.admin.serverFonts.upload.reasons.unsupportedType'
    case 'FONT_INVALID_FILE':
      return 'settings.admin.serverFonts.upload.reasons.invalidFile'
    case 'FONT_FACE_TAKEN':
      return 'settings.admin.serverFonts.upload.reasons.faceTaken'
    case 'FONT_LIMIT_REACHED':
      return scope === 'user' ? 'settings.reader.fonts.library.limitReached' : 'settings.admin.serverFonts.upload.reasons.limitReached'
    default:
      return 'settings.admin.serverFonts.upload.reasons.failed'
  }
}
