<script setup lang="ts">
import { cn } from '@/lib/utils'
import { useI18n } from 'vue-i18n'
import { Ellipsis } from '@lucide/vue'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { outlineButton } from './browse-header'

/** The page's own rarely used actions, so they never compete with the bar for room. */
defineProps<{
  name: string
}>()

const { t } = useI18n()
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <button type="button" :class="cn(outlineButton, 'w-8 justify-center px-0')" :aria-label="t('components.browseHeader.menu.more', { name })">
        <Ellipsis :size="16" aria-hidden="true" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-64">
      <slot />
    </DropdownMenuContent>
  </DropdownMenu>
</template>
