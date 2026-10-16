<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { PanelLeft } from '@lucide/vue'
import { useSidebar } from '@/components/ui/sidebar/utils'

/** Opens the phone sidebar sheet. Renders nothing outside the shell, where there is no sidebar to open. */
const { t } = useI18n()
const sidebar = useSidebar(null)

function handleOpen() {
  sidebar?.setOpenMobile(true)
}
</script>

<template>
  <button
    v-if="sidebar"
    type="button"
    class="grid shrink-0 place-items-center rounded-md text-foreground transition-colors hover:bg-(--shell-accent-wash) md:hidden"
    :aria-label="t('components.ui.sidebar.open')"
    @click="handleOpen"
  >
    <PanelLeft :size="17" aria-hidden="true" />
  </button>
</template>
