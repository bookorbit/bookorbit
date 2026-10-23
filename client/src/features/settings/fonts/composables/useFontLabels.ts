import { useI18n } from 'vue-i18n'
import type { UserFont } from '@bookorbit/types'
import { isVariableFont } from '@bookorbit/types'
import { FONT_WEIGHT_LABEL_KEYS, fontVariantLabel } from '@/features/reader/shared/lib/font-variants'
import { formatDate } from '@/i18n/formatters'
import { formatBytes } from '@/lib/formatting'
import { styleSummary } from '../lib/font-style-grid'

/** The wording the Server Fonts page uses for families and files, in one place. */
export function useFontLabels() {
  const { t } = useI18n()

  /** "Medium only", "16 styles", "9 styles, no italics". */
  function styleSummaryText(fonts: readonly UserFont[]): string {
    const summary = styleSummary(fonts)
    if (summary.kind === 'single') return t('settings.admin.serverFonts.styles.single', { style: fontVariantLabel(summary.variant, t) })
    if (summary.kind === 'many') {
      return t(summary.italics ? 'settings.admin.serverFonts.styles.many' : 'settings.admin.serverFonts.styles.manyNoItalics', {
        count: summary.count,
      })
    }
    return ''
  }

  function familySize(fonts: readonly UserFont[]): string {
    return formatBytes(fonts.reduce((sum, font) => sum + font.fileSize, 0))
  }

  function fileCountSummary(fonts: readonly UserFont[]): string {
    return t('settings.admin.serverFonts.fileSummary', { count: fonts.length, size: familySize(fonts) })
  }

  /** What one file contributes: its weight or variable range, and whether it is upright or italic. */
  function fileFace(font: UserFont): string {
    const weight = isVariableFont(font)
      ? t('settings.reader.fonts.variableRange', { min: font.weightMin, max: font.weightMax })
      : FONT_WEIGHT_LABEL_KEYS[font.weight]
        ? t(FONT_WEIGHT_LABEL_KEYS[font.weight]!)
        : String(font.weight)
    const slant = t(font.style === 'italic' ? 'settings.admin.serverFonts.sheet.italic' : 'settings.admin.serverFonts.sheet.upright')
    return `${weight} · ${slant}`
  }

  function fileDetail(font: UserFont): string {
    return t('settings.admin.serverFonts.sheet.fileDetail', {
      summary: fileFace(font),
      date: formatDate(new Date(font.createdAt), { month: 'short', day: 'numeric', year: 'numeric' }),
    })
  }

  return { styleSummaryText, familySize, fileCountSummary, fileFace, fileDetail }
}
