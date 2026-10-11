<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Moon, Sun, Wallpaper } from '@lucide/vue'
import AccentPicker from '@/components/AccentPicker.vue'
import BackgroundPicker from '@/components/BackgroundPicker.vue'
import RadiusPicker from '@/components/RadiusPicker.vue'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ACCENT_OPTIONS, RADIUS_OPTIONS, useThemeStore } from '@/stores/theme'

const props = withDefaults(defineProps<{ placement?: 'top' | 'bottom' }>(), { placement: 'bottom' })

const { t } = useI18n()
const themeStore = useThemeStore()

const isDark = computed(() => themeStore.resolvedTheme === 'dark')
const themeToggleLabel = computed(() => (isDark.value ? t('auth.themePicker.switchToLight') : t('auth.themePicker.switchToDark')))
const currentAccent = computed(() => ACCENT_OPTIONS.find((option) => option.id === themeStore.accent))
const currentRadiusPreview = computed(() => RADIUS_OPTIONS.find((option) => option.id === themeStore.radius)?.previewRadius ?? '3px')
const popoverSide = computed(() => (props.placement === 'top' ? 'bottom' : 'top'))

function handleToggleTheme() {
  themeStore.toggleTheme()
}
</script>

<template>
  <div class="fixed right-5 z-20 flex items-center gap-1.5" :class="placement === 'top' ? 'top-5' : 'bottom-5'">
    <Tooltip>
      <TooltipTrigger as-child>
        <button type="button" class="auth-appearance-button" :aria-label="themeToggleLabel" @click="handleToggleTheme">
          <Sun v-if="isDark" :size="14" />
          <Moon v-else :size="14" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{{ themeToggleLabel }}</TooltipContent>
    </Tooltip>

    <Tooltip>
      <Popover>
        <TooltipTrigger as-child>
          <PopoverTrigger as-child>
            <button type="button" class="auth-appearance-button" :aria-label="t('auth.themePicker.changeRadius')">
              <span class="block size-3.5 border-2 border-current" :style="{ borderRadius: currentRadiusPreview }" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <PopoverContent :side="popoverSide" align="end" class="auth-appearance-popover w-auto p-2.5">
          <RadiusPicker />
        </PopoverContent>
      </Popover>
      <TooltipContent>{{ t('auth.themePicker.changeRadius') }}</TooltipContent>
    </Tooltip>

    <Tooltip>
      <Popover>
        <TooltipTrigger as-child>
          <PopoverTrigger as-child>
            <button type="button" class="auth-appearance-button" :aria-label="t('auth.themePicker.changeBackground')">
              <Wallpaper :size="14" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <PopoverContent :side="popoverSide" align="end" class="auth-appearance-popover max-h-72 w-64 overflow-y-auto p-2.5">
          <BackgroundPicker />
        </PopoverContent>
      </Popover>
      <TooltipContent>{{ t('auth.themePicker.changeBackground') }}</TooltipContent>
    </Tooltip>

    <Tooltip>
      <Popover>
        <TooltipTrigger as-child>
          <PopoverTrigger as-child>
            <button type="button" class="auth-appearance-button" :aria-label="t('auth.themePicker.changeAccent')">
              <span class="block size-3.5 rounded-full" :class="currentAccent?.swatchClass" :style="{ backgroundColor: currentAccent?.color }" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <PopoverContent :side="popoverSide" align="end" class="auth-appearance-popover w-auto max-w-[calc(100vw-2rem)] overflow-x-auto p-3">
          <AccentPicker />
        </PopoverContent>
      </Popover>
      <TooltipContent>{{ t('auth.themePicker.changeAccent') }}</TooltipContent>
    </Tooltip>
  </div>
</template>

<style scoped>
.auth-appearance-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: 9999px;
  background: color-mix(in oklch, var(--card) 72%, transparent);
  border: 1px solid color-mix(in oklch, var(--border) 55%, transparent);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  box-shadow: var(--elevation-md);
  color: var(--muted-foreground);
  transition: color 0.15s ease;
}

.auth-appearance-button:hover,
.auth-appearance-button:focus-visible {
  color: var(--foreground);
}

.auth-appearance-button:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}

:global(.auth-appearance-popover) {
  background: color-mix(in oklch, var(--card) 80%, transparent);
  border-color: color-mix(in oklch, var(--border) 55%, transparent);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  box-shadow: var(--elevation-lg);
}
</style>
