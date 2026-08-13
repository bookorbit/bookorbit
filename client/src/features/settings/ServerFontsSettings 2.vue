<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useCustomFonts } from '@/features/reader/epub/composables/useCustomFonts'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import FontLibraryPanel from './FontLibraryPanel.vue'
import SettingsPageHeader from './SettingsPageHeader.vue'

withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const { t } = useI18n()

const store = useCustomFonts().scopeStore('server')
const { isDemoRestrictedAccount } = usePermissions()
</script>

<template>
  <div>
    <SettingsPageHeader v-if="!embedded" :title="t('settings.admin.serverFonts.title')" :subtitle="t('settings.admin.serverFonts.subtitle')" />
    <p v-else class="mb-5 text-sm text-muted-foreground">{{ t('settings.admin.serverFonts.subtitle') }}</p>

    <FontLibraryPanel :store="store" :readonly="isDemoRestrictedAccount" />
  </div>
</template>
