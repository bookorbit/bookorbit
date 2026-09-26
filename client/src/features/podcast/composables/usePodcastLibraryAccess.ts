import { computed, type Ref } from 'vue'
import { Permission, type Library } from '@bookorbit/types'
import { usePermissions } from '@/features/auth/composables/usePermissions'

/**
 * What the signed-in user may do in one podcast library. Every podcast surface needs the same
 * derivation: a permission the role grants, narrowed by the access level on the library itself.
 * A superuser bypasses the access level but still needs the permission.
 */
export function usePodcastLibraryAccess(library: Ref<Library | undefined>) {
  const { hasPermission, isSuperuser } = usePermissions()

  const accessLevel = computed(() => library.value?.accessLevel)
  const hasEditorAccess = computed(() => isSuperuser.value || accessLevel.value === 'editor' || accessLevel.value === 'owner')
  const hasOwnerAccess = computed(() => isSuperuser.value || accessLevel.value === 'owner')

  return {
    hasEditorAccess,
    hasOwnerAccess,
    canManageFeeds: computed(() => hasPermission(Permission.PodcastManageFeeds) && hasEditorAccess.value),
    canEditMetadata: computed(() => hasPermission(Permission.PodcastEditMetadata) && hasEditorAccess.value),
    canDownload: computed(() => hasPermission(Permission.PodcastDownload)),
    canManageRetention: computed(() => hasPermission(Permission.PodcastManageRetention) && hasOwnerAccess.value),
    canExport: computed(() => hasPermission(Permission.PodcastManageFeeds) && hasOwnerAccess.value),
    canPurge: computed(() => hasPermission(Permission.PodcastPurge) && hasOwnerAccess.value),
  }
}
