<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { Search } from '@lucide/vue'
import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import { useCommandPalette } from '@/features/command-palette/composables/useCommandPalette'

/**
 * Phones have no global header. Pages that open with a title row carry the menu and search buttons
 * themselves (route `meta.titleRow`); every other page gets this slim bar so navigation is never lost.
 */
const { t } = useI18n()
const route = useRoute()
const { isMobile } = useSidebar()
const { openPalette } = useCommandPalette()

const visible = computed(() => isMobile.value && route.meta.titleRow !== true)

function handleSearch() {
  openPalette()
}
</script>

<template>
  <div
    v-if="visible"
    class="relative z-30 mx-(--shell-gap) mt-(--shell-gap) flex h-12 flex-none shrink-0 items-center gap-2 rounded-(--shell-radius) border border-(--shell-border) bg-(--shell-surface) px-2 shadow-(--shell-shadow) shell-backdrop"
    data-testid="mobile-shell-bar"
  >
    <SidebarTrigger class="size-9 rounded-md text-foreground hover:bg-(--shell-accent-wash)" />
    <span class="flex-1" aria-hidden="true" />
    <button
      type="button"
      class="grid size-9 place-items-center rounded-md text-foreground transition-colors hover:bg-(--shell-accent-wash)"
      :aria-label="t('common.search')"
      @click="handleSearch"
    >
      <Search :size="17" aria-hidden="true" />
    </button>
  </div>
</template>
