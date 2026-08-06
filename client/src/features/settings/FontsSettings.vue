<script setup lang="ts">
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCustomFonts } from '@/features/reader/epub/composables/useCustomFonts'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import FontLibraryPanel from './FontLibraryPanel.vue'
import ServerFontVisibility from './ServerFontVisibility.vue'
import SettingsPageHeader from './SettingsPageHeader.vue'

const { t } = useI18n()

const customFonts = useCustomFonts()
const store = customFonts.scopeStore('user')
const { isDemoRestrictedAccount } = usePermissions()

// The panel loads the user's own fonts; the shared collection and this reader's
// opt-outs are only needed for the visibility section below it.
onMounted(async () => {
  await Promise.all([customFonts.fetchServerFonts(), customFonts.fetchServerFontVisibility()])
})
</script>

<template>
  <div>
    <SettingsPageHeader :title="t('settings.reader.fonts.title')" :subtitle="t('settings.reader.fonts.subtitle')" />
    <FontLibraryPanel :store="store" :readonly="isDemoRestrictedAccount" />
    <ServerFontVisibility :custom-fonts="customFonts" />
  </div>
</template>
