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

interface Group {
  id: string
  label: string
  sections: Section[]
}

const groups = computed<Group[]>(() => {
  const perms = userPermissions.value
  const su = isSuperuser.value

  const generalSections: Section[] = [
    { label: 'Libraries', routeName: 'settings-libraries' },
    { label: 'Appearance', routeName: 'settings-appearance' },
  ]
  if (su || perms.includes('opds_access')) {
    generalSections.push({ label: 'OPDS', routeName: 'settings-opds' })
  }
  if (su || perms.includes('kobo_sync')) {
    generalSections.push({ label: 'Kobo', routeName: 'settings-kobo' })
  }
  if (su || perms.includes('email_send')) {
    generalSections.push({ label: 'Email', routeName: 'settings-email' })
  }

  const result: Group[] = [
    {
      id: 'general',
      label: 'General',
      sections: generalSections,
    },
    {
      id: 'reader',
      label: 'Reader',
      sections: [
        { label: 'General', routeName: 'settings-reader-general' },
        { label: 'eBook', routeName: 'settings-reader-ebook' },
        { label: 'PDF', routeName: 'settings-reader-pdf' },
        { label: 'Comics', routeName: 'settings-reader-comics' },
      ],
    },
  ]

  const adminSections: Section[] = []
  if (su || perms.includes('manage_users')) {
    adminSections.push({ label: 'Users', routeName: 'settings-admin-users' })
  }
  if (su || perms.includes('manage_metadata_config')) {
    adminSections.push({ label: 'Metadata', routeName: 'settings-admin-metadata' })
  }
  if (su || perms.includes('manage_app_settings')) {
    adminSections.push({ label: 'OIDC / SSO', routeName: 'settings-admin-oidc' })
    adminSections.push({ label: 'File Naming', routeName: 'settings-admin-file-naming' })
    adminSections.push({ label: 'Staging', routeName: 'settings-admin-staging' })
    adminSections.push({ label: 'Maintenance', routeName: 'settings-admin-maintenance' })
  }
  if (adminSections.length) {
    result.push({ id: 'admin', label: 'Administration', sections: adminSections })
  }

  result.push({
    id: 'system',
    label: 'System',
    sections: [{ label: 'About', routeName: 'settings-about' }],
  })

  return result
})
</script>

<template>
  <div class="flex items-stretch h-11 px-2 border-b overflow-x-auto shrink-0 scrollbar-none">
    <template v-for="group in groups" :key="group.id">
      <span
        class="flex items-center px-2 text-[10px] font-semibold text-muted-foreground/35 uppercase tracking-widest whitespace-nowrap shrink-0 select-none"
      >
        {{ group.label }}
      </span>
      <button
        v-for="section in group.sections"
        :key="section.routeName"
        class="px-3 h-full text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0"
        :class="
          route.name === section.routeName ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
        "
        @click="router.push({ name: section.routeName })"
      >
        {{ section.label }}
      </button>
    </template>
  </div>
</template>
