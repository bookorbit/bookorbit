import { computed, ref, type ComputedRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import type { FontFamily } from '@/features/reader/epub/composables/useCustomFonts'
import type { useFontLibrary } from './useFontLibrary'

/**
 * Which family's sheet is open, how it was opened, and what its Save, Remove and file actions do.
 * A row's "Rename family" opens it with the name focused; "Remove family" opens it already asking.
 */
export function useFamilySheet(library: ReturnType<typeof useFontLibrary>, families: ComputedRef<FontFamily[]>) {
  const { t } = useI18n()

  const openName = ref<string | null>(null)
  const armRemove = ref(false)
  const focusName = ref(false)
  const busy = ref(false)

  const openFamily = computed(() => families.value.find((family) => family.name === openName.value) ?? null)
  const openUse = computed(() => library.usageOf(openFamily.value?.cssFamilyName ?? ''))

  function open(name: string, options: { remove?: boolean; rename?: boolean } = {}) {
    armRemove.value = options.remove ?? false
    focusName.value = options.rename ?? false
    openName.value = name
  }
  function close() {
    openName.value = null
    armRemove.value = false
    focusName.value = false
  }

  async function rename(newName: string) {
    const name = openName.value
    if (!name) return
    busy.value = true
    const result = await library.renameFamily(name, newName)
    busy.value = false
    if (result.ok) {
      toast.success(t('settings.reader.fonts.renamedTo', { name: newName }))
      close()
    } else if (result.code === 'FONT_FACE_TAKEN') {
      toast.error(t('settings.admin.serverFonts.toasts.renameTaken', { name: newName }))
    } else {
      toast.error(t('settings.reader.fonts.renameFamilyFailed'))
    }
  }

  async function removeFamily() {
    const name = openName.value
    if (!name) return
    busy.value = true
    const { failed } = await library.removeFamily(name)
    busy.value = false
    if (failed === 0) {
      toast.success(t('settings.admin.serverFonts.toasts.removed', { name }))
      close()
    } else {
      toast.error(t('settings.admin.serverFonts.toasts.removePartial', { failed, name }))
    }
  }

  async function updateFile(fontId: number, data: { weight: number; style: 'normal' | 'italic' }) {
    if (!(await library.updateFile(fontId, data))) toast.error(t('settings.reader.fonts.updateVariantFailed'))
  }

  async function removeFile(fontId: number) {
    const ok = await library.store.deleteFont(fontId).catch(() => false)
    if (!ok) {
      toast.error(t('settings.reader.fonts.deleteFontFailed'))
      return
    }
    if (!openFamily.value) close()
    await library.fetchUsage()
  }

  return { openName, openFamily, openUse, armRemove, focusName, busy, open, close, rename, removeFamily, updateFile, removeFile }
}
