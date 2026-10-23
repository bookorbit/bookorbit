<script setup lang="ts">
import { computed, useId } from 'vue'
import type { SidebarSectionId } from '@bookorbit/types'
import { SidebarGroup, SidebarGroupContent, SidebarMenu } from '@/components/ui/sidebar'
import SidebarSectionHeader from '@/components/sidebar/SidebarSectionHeader.vue'
import SidebarSectionBody from '@/components/sidebar/SidebarSectionBody.vue'
import { useSidebarPrefs } from '@/composables/useSidebarPrefs'

const props = withDefaults(
  defineProps<{
    label?: string | null
    /** Zones without a section id are always rendered and get a plain, non-interactive label. */
    sectionId?: SidebarSectionId
    alwaysOpen?: boolean
  }>(),
  { alwaysOpen: false },
)

const { sections, toggleSection } = useSidebarPrefs()
const contentId = `sidebar-zone-${useId()}`
const isOpen = computed(() => props.alwaysOpen || !props.sectionId || sections[props.sectionId].open)

function handleToggle() {
  if (props.sectionId) toggleSection(props.sectionId)
}
</script>

<template>
  <SidebarGroup>
    <SidebarSectionHeader
      v-if="label && sectionId"
      :label="label"
      :is-open="isOpen"
      :content-id="contentId"
      :collapsible="!alwaysOpen"
      :can-customize="!alwaysOpen"
      @toggle="handleToggle"
    />
    <p v-else-if="label" class="mb-0.5 px-2 pt-1.5 pb-1 sidebar-section-label group-data-[collapsible=icon]:hidden">
      {{ label }}
    </p>
    <SidebarSectionBody :open="isOpen" :content-id="sectionId ? contentId : undefined">
      <SidebarGroupContent>
        <SidebarMenu>
          <slot />
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarSectionBody>
  </SidebarGroup>
</template>
