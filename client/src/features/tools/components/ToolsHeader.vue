<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Wrench } from '@lucide/vue'
import { usePermissions } from '@/features/auth/composables/usePermissions'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { hasPermission } = usePermissions()

interface ToolSection {
  label: string
  routeName: string
}

const sections = computed<ToolSection[]>(() => {
  const result: ToolSection[] = []

  if (hasPermission('manage_libraries')) {
    result.push({ label: t('tools.header.entityManager'), routeName: 'tools-entity-manager' })
    result.push({ label: t('tools.header.bulkRename'), routeName: 'tools-bulk-rename' })
  }

  if (hasPermission('library_delete_books')) {
    result.push({ label: t('tools.header.duplicateBooks'), routeName: 'tools-duplicate-books' })
    result.push({ label: t('tools.header.missingResources'), routeName: 'tools-missing-resources' })
  }

  if (hasPermission('library_edit_metadata')) {
    result.push({ label: t('tools.header.chapterHealth'), routeName: 'tools-chapter-health' })
  }

  return result
})

function navigateToSection(section: ToolSection): void {
  router.push({ name: section.routeName })
}
</script>

<template>
  <div class="flex items-stretch h-11 px-4 border-b overflow-x-auto shrink-0 scrollbar-none snap-x snap-mandatory md:snap-none">
    <!-- Without a global header the band names the page itself. -->
    <div class="flex shrink-0 items-center gap-2 border-e border-border/70 pe-4 me-2 my-3 max-sm:hidden">
      <Wrench :size="16" class="text-primary" aria-hidden="true" />
      <span class="text-sm font-semibold text-foreground">{{ t('components.sidebar.tools') }}</span>
    </div>
    <button
      v-for="section in sections"
      :key="section.routeName"
      class="px-3 h-full text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 snap-start"
      :class="route.name === section.routeName ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'"
      @click="navigateToSection(section)"
    >
      {{ section.label }}
    </button>
  </div>
</template>
