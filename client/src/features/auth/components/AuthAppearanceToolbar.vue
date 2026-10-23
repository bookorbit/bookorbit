<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, Globe, Moon, Sun, Wallpaper } from '@lucide/vue'
import { LOCALE_LABELS, type Locale } from '@bookorbit/types'
import AccentPicker from '@/components/AccentPicker.vue'
import LanguagePicker from '@/components/LanguagePicker.vue'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useLocaleStore } from '@/stores/locale'
import { ACCENT_OPTIONS, useThemeStore } from '@/stores/theme'
import AuthEndpaperPicker from './AuthEndpaperPicker.vue'

const { t } = useI18n()
const themeStore = useThemeStore()
const localeStore = useLocaleStore()

const languageOpen = ref(false)
const languageError = ref(false)

const isDark = computed(() => themeStore.resolvedTheme === 'dark')
const themeToggleLabel = computed(() => (isDark.value ? t('auth.themePicker.switchToLight') : t('auth.themePicker.switchToDark')))
const currentAccent = computed(() => ACCENT_OPTIONS.find((option) => option.id === themeStore.accent))
const currentLanguage = computed(() => LOCALE_LABELS[localeStore.locale])

function handleToggleTheme() {
  themeStore.toggleTheme()
}

async function handleSelectLanguage(locale: Locale) {
  languageOpen.value = false
  languageError.value = false
  try {
    await localeStore.setLocale(locale)
  } catch {
    languageError.value = true
  }
}
</script>

<template>
  <div class="absolute end-3 top-3 z-20 flex items-center gap-1 sm:end-5 sm:top-5 sm:gap-1.5">
    <Popover v-model:open="languageOpen">
      <PopoverTrigger as-child>
        <button
          type="button"
          class="auth-appearance-button gap-1.5 px-0 sm:w-auto sm:px-2.5"
          :aria-label="t('settings.appearance.language.label')"
          data-testid="auth-language-control"
        >
          <Globe :size="14" aria-hidden="true" />
          <span class="hidden text-[0.78125rem] font-medium sm:inline">{{ currentLanguage }}</span>
          <ChevronDown :size="13" class="hidden text-muted-foreground sm:inline" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" class="auth-appearance-popover w-80 max-w-[calc(100vw-1.5rem)] p-1">
        <LanguagePicker :autofocus="languageOpen" class="max-h-[min(26rem,calc(100dvh-8rem))]" @select="handleSelectLanguage" />
        <p v-if="languageError" role="alert" class="px-2.5 pt-1 pb-2 text-xs text-destructive">{{ t('settings.appearance.language.loadError') }}</p>
      </PopoverContent>
    </Popover>

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
            <button type="button" class="auth-appearance-button" :aria-label="t('auth.endpaper.change')">
              <Wallpaper :size="14" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <PopoverContent side="bottom" align="end" class="auth-appearance-popover w-72 max-w-[calc(100vw-1.5rem)] p-2.5">
          <AuthEndpaperPicker />
        </PopoverContent>
      </Popover>
      <TooltipContent>{{ t('auth.endpaper.change') }}</TooltipContent>
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
        <PopoverContent side="bottom" align="end" class="auth-appearance-popover w-auto max-w-[calc(100vw-2rem)] overflow-x-auto p-3">
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
  min-width: 2rem;
  height: 2rem;
  border-radius: 9999px;
  background: color-mix(in oklch, var(--card) 72%, transparent);
  border: 1px solid color-mix(in oklch, var(--border) 55%, transparent);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  box-shadow: var(--elevation-md);
  color: var(--foreground);
  transition: background-color 0.15s ease;
}

.auth-appearance-button:hover,
.auth-appearance-button:focus-visible {
  background: color-mix(in oklch, var(--card) 92%, transparent);
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
