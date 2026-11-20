<script setup lang="ts">
import { useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { PanelLeft } from '@lucide/vue'
import { useSidebar } from '@/components/ui/sidebar/utils'
import JobsNeedsYouDot from '@/features/jobs/components/JobsNeedsYouDot.vue'
import { useJobsNeedsYou } from '@/features/jobs/composables/useJobsSummary'

/** Opens the phone sidebar sheet. Renders nothing outside the shell, where there is no sidebar to open. */
const { t } = useI18n()
const sidebar = useSidebar(null)
const needsYou = useJobsNeedsYou()
const descriptionId = useId()

function handleOpen() {
  sidebar?.setOpenMobile(true)
}
</script>

<template>
  <button
    v-if="sidebar"
    type="button"
    class="relative grid shrink-0 place-items-center rounded-md text-foreground transition-colors hover:bg-(--shell-accent-wash) md:hidden"
    :aria-label="t('components.ui.sidebar.open')"
    :aria-describedby="needsYou > 0 ? descriptionId : undefined"
    @click="handleOpen"
  >
    <PanelLeft :size="17" aria-hidden="true" />
    <JobsNeedsYouDot :description-id="descriptionId" />
  </button>
</template>
