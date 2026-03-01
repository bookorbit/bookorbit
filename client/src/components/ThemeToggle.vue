<script setup lang="ts">
import { Moon, Sun } from 'lucide-vue-next'
import { useThemeStore } from '@/stores/theme'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const themeStore = useThemeStore()
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <button
        @click="themeStore.toggleTheme()"
        class="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        :aria-label="themeStore.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
      >
        <Sun v-if="themeStore.theme === 'dark'" :size="16" />
        <Moon v-else :size="16" />
      </button>
    </TooltipTrigger>
    <TooltipContent>{{ themeStore.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode' }}</TooltipContent>
  </Tooltip>
</template>
