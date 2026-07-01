<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { Permission } from '@bookorbit/types'
import { usePermissions } from '@/features/auth/composables/usePermissions'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { isSuperuser, userPermissions } = usePermissions()

interface Section {
  label: string
  routeName: string
}

function handleNavigate(routeName: string): void {
  router.push({ name: routeName })
}

const sections = computed<Section[]>(() => {
  const perms = userPermissions.value
  const su = isSuperuser.value

  const result: Section[] = []

  if (su || perms.includes('manage_libraries')) {
    result.push({ label: t('settings.common.nav.libraries'), routeName: 'settings-libraries' })
  }

  result.push({ label: t('settings.common.nav.display'), routeName: 'settings-appearance' })
  result.push({ label: t('settings.common.nav.reader'), routeName: 'settings-reader-general' })

  if (su || perms.includes('manage_metadata_config') || perms.includes('manage_libraries')) {
    result.push({ label: t('settings.common.nav.metadata'), routeName: 'settings-admin-metadata' })
  }

  if (su || perms.includes('email_send') || perms.includes('manage_email')) {
    result.push({ label: t('settings.common.nav.email'), routeName: 'settings-email' })
  }

  if (su || perms.includes('opds_access')) {
    result.push({ label: t('settings.common.nav.opds'), routeName: 'settings-opds' })
  }

  if (su || perms.includes(Permission.KoboSync)) {
    result.push({ label: t('settings.common.nav.kobo'), routeName: 'settings-kobo' })
  }

  if (su || perms.includes(Permission.KoreaderSync)) {
    result.push({ label: t('settings.common.nav.koreader'), routeName: 'settings-koreader' })
  }

  if (su || perms.includes(Permission.HardcoverSync) || perms.includes(Permission.ReadwiseSync) || perms.includes(Permission.StorygraphSync)) {
    result.push({ label: 'Integrations', routeName: 'settings-integrations' })
  }

  if (su || perms.includes('manage_users') || perms.includes('manage_app_settings')) {
    result.push({ label: t('settings.common.nav.admin'), routeName: 'settings-admin' })
  }

  if (su || perms.includes('manage_app_settings') || perms.includes('book_dock_access')) {
    result.push({ label: t('settings.common.nav.system'), routeName: 'settings-system' })
  }

  result.push({ label: t('settings.common.nav.account'), routeName: 'settings-account' })

  return result
})
</script>

<template>
  <div class="flex items-stretch h-11 px-4 border-b overflow-x-auto shrink-0 scrollbar-none snap-x snap-mandatory md:snap-none">
    <button
      v-for="section in sections"
      :key="section.routeName"
      class="px-3 h-full text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 snap-start"
      :class="route.name === section.routeName ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'"
      @click="handleNavigate(section.routeName)"
    >
      {{ section.label }}
    </button>
  </div>
</template>
