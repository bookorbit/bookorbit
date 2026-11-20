import { isLibraryDockErrorCode } from '@bookorbit/types'

type Translate = (key: string, params?: Record<string, unknown>) => string

/** Words for a refused dock change; a code this client does not know reads as a plain failure. */
export function libraryDockErrorMessage(code: string | null, t: Translate): string {
  return isLibraryDockErrorCode(code) ? t(`settings.reader.bookDock.docks.error.${code}`) : t('settings.reader.bookDock.docks.error.generic')
}
