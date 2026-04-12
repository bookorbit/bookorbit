<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePermissions } from '@/features/auth/composables/usePermissions'

const route = useRoute()
const router = useRouter()
const { isSuperuser, userPermissions } = usePermissions()

interface Section {
  label: string
  routeName: string
}

const sections = computed<Section[]>(() => {
  const perms = userPermissions.value
  const su = isSuperuser.value

  const result: Section[] = []

  if (su || perms.includes('manage_libraries')) {
    result.push({ label: 'Libraries', routeName: 'settings-libraries' })
  }

  result.push({ label: 'Appearance', routeName: 'settings-appearance' })
  result.push({ label: 'Reader', routeName: 'settings-reader-general' })

  if (su || perms.includes('manage_metadata_config')) {
    result.push({ label: 'Metadata', routeName: 'settings-admin-metadata' })
  }
  if (su || perms.includes('book_bucket_access')) {
    result.push({ label: 'Book Bucket', routeName: 'settings-admin-book-bucket' })
  }
  if (su || perms.includes('manage_app_settings')) {
    result.push({ label: 'File Naming', routeName: 'settings-admin-file-naming' })
  }
  if (su || perms.includes('manage_users')) {
    result.push({ label: 'Users', routeName: 'settings-admin-users' })
  }
  if (su || perms.includes('manage_app_settings')) {
    result.push({ label: 'OIDC / SSO', routeName: 'settings-admin-oidc' })
  }
  if (su || perms.includes('email_send') || perms.includes('manage_email')) {
    result.push({ label: 'Email', routeName: 'settings-email' })
  }
  if (su || perms.includes('opds_access')) {
    result.push({ label: 'OPDS', routeName: 'settings-opds' })
  }
  if (su || perms.includes('kobo_sync')) {
    result.push({ label: 'Kobo', routeName: 'settings-kobo' })
  }
  if (su || perms.includes('manage_app_settings')) {
    result.push({ label: 'Maintenance', routeName: 'settings-admin-maintenance' })
  }

  result.push({ label: 'Account', routeName: 'settings-account' })

  if (su) {
    result.push({ label: 'Audit Log', routeName: 'settings-admin-audit-log' })
  }

  return result
})
</script>

<template>
  <div class="flex items-stretch h-11 px-6 border-b overflow-x-auto shrink-0 scrollbar-none snap-x snap-mandatory md:snap-none">
    <button
      v-for="section in sections"
      :key="section.routeName"
      class="px-3 h-full text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 snap-start"
      :class="route.name === section.routeName ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'"
      @click="router.push({ name: section.routeName })"
    >
      {{ section.label }}
    </button>
  </div>
</template>
