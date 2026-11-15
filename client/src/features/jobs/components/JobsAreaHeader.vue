<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Activity, Settings } from '@lucide/vue'
import { Permission } from '@bookorbit/types'

import PageTitleRow from '@/components/page-header/PageTitleRow.vue'
import { Button } from '@/components/ui/button'
import { usePermissions } from '@/features/auth/composables/usePermissions'

const route = useRoute()
const { t } = useI18n()
const { hasPermission } = usePermissions()

interface JobsSection {
  label: string
  routeName: string
}

const manages = computed(() => hasPermission(Permission.ManageAppSettings))

const sections = computed<JobsSection[]>(() => {
  const result: JobsSection[] = [{ label: t('aiArea.sections.activity'), routeName: 'jobs-activity' }]
  if (manages.value) result.push({ label: t('aiArea.sections.storyGuides'), routeName: 'jobs-story-guides' })
  return result
})
</script>

<template>
  <div>
    <PageTitleRow class="mb-4" :title="t('jobsArea.title')" :icon="Activity">
      <template #facts>
        <span class="truncate max-sm:hidden">{{ t('jobsArea.subtitle') }}</span>
      </template>
      <template v-if="manages" #actions>
        <Button variant="outline" size="sm" as-child>
          <RouterLink :to="{ name: 'settings-admin-ai' }" data-testid="jobs-area-settings-link">
            <Settings class="size-4" aria-hidden="true" />
            <span class="max-sm:sr-only">{{ t('aiArea.settingsLink') }}</span>
          </RouterLink>
        </Button>
      </template>
    </PageTitleRow>

    <nav class="mb-5 flex gap-1 overflow-x-auto border-b border-border scrollbar-none" :aria-label="t('jobsArea.sectionsLabel')">
      <RouterLink
        v-for="section in sections"
        :key="section.routeName"
        :to="{ name: section.routeName }"
        class="-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset motion-reduce:transition-none"
        :class="
          route.name === section.routeName ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
        "
        :aria-current="route.name === section.routeName ? 'page' : undefined"
      >
        {{ section.label }}
      </RouterLink>
    </nav>
  </div>
</template>
