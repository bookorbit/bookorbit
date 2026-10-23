import { onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { toast } from 'vue-sonner'
import { Permission } from '@bookorbit/types'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useCommandPalette } from '@/features/command-palette/composables/useCommandPalette'
import { useLibraryUploadEvents } from '@/features/library/composables/useLibraryUploadEvents'
import { useNotifications } from '@/features/notifications/composables/useNotifications'

/**
 * Work the global header used to own. It lives with the layout, not the sidebar dock, because the
 * phone sidebar is a sheet that is not mounted until it opens.
 */
export function useShellServices() {
  const { t } = useI18n()
  const route = useRoute()
  const { hasPermission, isDemoRestrictedAccount } = usePermissions()
  const { subscribe: subscribeNotifications } = useNotifications()
  const { onLibraryUploadCompleted } = useLibraryUploadEvents()
  const { isOpen, openPalette } = useCommandPalette()

  function handleGlobalKeydown(event: KeyboardEvent) {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return
    // Settings binds the same chord to its own page search, and says so on screen.
    if (typeof route.name === 'string' && route.name.startsWith('settings-')) return
    event.preventDefault()
    if (!isOpen.value) openPalette()
  }

  const stopLibraryUploadListener = onLibraryUploadCompleted((event) => {
    if (event.uploadedCount === 0 && event.failedCount === 0) return

    const uploadedLabel = t('components.appHeader.bookCount', { count: event.uploadedCount })
    const failedLabel = t('components.appHeader.fileCount', { count: event.failedCount })

    if (event.failedCount === 0) {
      toast.success(t('components.appHeader.uploadedToast', { uploaded: uploadedLabel }))
      return
    }
    if (event.uploadedCount === 0) {
      toast.error(t('components.appHeader.uploadFailedToast', { failed: failedLabel }))
      return
    }

    toast.warning(t('components.appHeader.uploadPartialToast', { uploaded: uploadedLabel, failed: failedLabel }))
  })

  onMounted(() => {
    window.addEventListener('keydown', handleGlobalKeydown)
    if (hasPermission(Permission.NotificationAccess) && !isDemoRestrictedAccount.value) subscribeNotifications()
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', handleGlobalKeydown)
    stopLibraryUploadListener()
  })
}
