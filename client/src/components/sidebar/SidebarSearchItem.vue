<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Search } from '@lucide/vue'
import { SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar'
import { useModifierKey } from '@/composables/useModifierKey'
import { useCommandPalette } from '@/features/command-palette/composables/useCommandPalette'

/** `framed` draws the row as a search field, for when the pages under it are an icon row. */
withDefaults(defineProps<{ framed?: boolean }>(), { framed: false })

const { t } = useI18n()
const { isMobile, setOpenMobile } = useSidebar()
const { modifierKey } = useModifierKey()
const { openPalette } = useCommandPalette()

function handleOpen() {
  if (isMobile.value) setOpenMobile(false)
  openPalette()
}
</script>

<template>
  <SidebarMenuItem>
    <SidebarMenuButton
      :tooltip="t('common.search')"
      class="group/item w-full min-w-0 gap-2 px-2 font-normal"
      :class="framed ? 'h-8 rounded-(--shell-radius) border border-(--shell-accent-line)' : 'h-7 rounded-md'"
      data-tour="global-search"
      aria-haspopup="dialog"
      @click="handleOpen"
    >
      <span class="inline-flex h-5 w-5 shrink-0 items-center justify-center">
        <Search :size="17" class="text-sidebar-foreground" aria-hidden="true" />
      </span>
      <span class="min-w-0 flex-1 truncate text-start text-[14px] text-sidebar-foreground group-data-[collapsible=icon]:hidden">
        {{ t('common.search') }}
      </span>
      <kbd
        v-if="!isMobile"
        class="inline-flex h-5 shrink-0 select-none items-center gap-1 rounded-xs border border-(--shell-accent-line) px-1.5 font-mono text-[11px] font-semibold text-muted-foreground group-data-[collapsible=icon]:hidden"
        aria-hidden="true"
      >
        <span class="leading-none">{{ modifierKey }}</span>
        <span class="leading-none">K</span>
      </kbd>
    </SidebarMenuButton>
  </SidebarMenuItem>
</template>
