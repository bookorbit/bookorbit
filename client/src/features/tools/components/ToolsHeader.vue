<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePermissions } from '@/features/auth/composables/usePermissions'

const route = useRoute()
const router = useRouter()
const { hasPermission } = usePermissions()

interface ToolSection {
  label: string
  routeName: string
}

const sections = computed<ToolSection[]>(() => {
  const result: ToolSection[] = []

  if (hasPermission('manage_libraries')) {
    result.push({ label: 'Entity Manager', routeName: 'tools-entity-manager' })
  }

  return result
})

function navigateToSection(section: ToolSection): void {
  router.push({ name: section.routeName })
}
</script>

<template>
  <div class="flex items-stretch h-11 px-4 border-b overflow-x-auto shrink-0 scrollbar-none snap-x snap-mandatory md:snap-none">
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
