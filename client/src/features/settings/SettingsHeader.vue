<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { Permission } from '@bookorbit/types'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import SettingsTabs from './components/SettingsTabs.vue'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { isSuperuser, userPermissions } = usePermissions()

interface Section {
  id: string
  label: string
}

function handleNavigate(routeName: string): void {
  router.push({ name: routeName })
}

const sections = computed<Section[]>(() => {
  const perms = userPermissions.value
  const su = isSuperuser.value

  const result: Section[] = []

  if (su || perms.includes('manage_libraries')) {
    result.push({
      id: 'settings-libraries',
      label: t('settings.common.nav.libraries'),
    })
  }

  result.push({
    id: 'settings-appearance',
    label: t('settings.common.nav.display'),
  })
  result.push({
    id: 'settings-reader-general',
    label: t('settings.common.nav.reader'),
  })

  if (su || perms.includes('manage_metadata_config') || perms.includes('manage_libraries')) {
    result.push({
      id: 'settings-admin-metadata',
      label: t('settings.common.nav.metadata'),
    })
  }

  if (su || perms.includes('email_send') || perms.includes('manage_email')) {
    result.push({
      id: 'settings-email',
      label: t('settings.common.nav.email'),
    })
  }

  if (su || perms.includes('opds_access')) {
    result.push({ id: 'settings-opds', label: t('settings.common.nav.opds') })
  }

  if (su || perms.includes(Permission.KoboSync)) {
    result.push({ id: 'settings-kobo', label: t('settings.common.nav.kobo') })
  }

  if (su || perms.includes(Permission.KoreaderSync)) {
    result.push({
      id: 'settings-koreader',
      label: t('settings.common.nav.koreader'),
    })
  }

  if (su || perms.includes(Permission.HardcoverSync) || perms.includes(Permission.ReadwiseSync) || perms.includes(Permission.StorygraphSync)) {
    result.push({
      id: 'settings-integrations',
      label: t('settings.common.nav.integrations'),
    })
  }

  if (su || perms.includes('manage_users') || perms.includes('view_user_activity') || perms.includes('manage_app_settings')) {
    result.push({
      id: 'settings-admin',
      label: t('settings.common.nav.admin'),
    })
  }

  if (su || perms.includes(Permission.ManageAppSettings) || perms.includes(Permission.ManageBookDock)) {
    result.push({
      id: 'settings-system',
      label: t('settings.common.nav.system'),
    })
  }

  result.push({
    id: 'settings-account',
    label: t('settings.common.nav.account'),
  })

  return result
})

const activeSection = computed(() => (typeof route.name === 'string' ? route.name : ''))
</script>

<template>
  <SettingsTabs variant="section" :tabs="sections" :active-tab="activeSection" @select="handleNavigate" />
</template>
