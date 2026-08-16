<script setup lang="ts">
import { onMounted } from 'vue'
import { useCustomFonts } from '@/features/reader/epub/composables/useCustomFonts'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import FontLibraryPanel from './FontLibraryPanel.vue'
import ServerFontVisibility from './ServerFontVisibility.vue'

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
    <FontLibraryPanel :store="store" :readonly="isDemoRestrictedAccount" />
    <ServerFontVisibility :custom-fonts="customFonts" />
  </div>
</template>
