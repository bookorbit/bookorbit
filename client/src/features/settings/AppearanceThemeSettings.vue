<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Moon, Sun } from '@lucide/vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ACCENT_PASTEL, ACCENT_VIVID, BACKGROUND_OPTIONS, RADIUS_OPTIONS, useThemeStore } from '@/stores/theme'
import AppearancePreferenceStorage from './AppearancePreferenceStorage.vue'

const { t } = useI18n()
const themeStore = useThemeStore()

const backgroundGroups = computed<{ label: string; ids: string[] }[]>(() => [
  { label: t('settings.appearance.theme.backgroundGroups.fundamental'), ids: ['none', 'dots', 'cross', 'terminal', 'millimeter'] },
  { label: t('settings.appearance.theme.backgroundGroups.structural'), ids: ['blueprint', 'brushed', 'scanlines', 'vinyl', 'carbon', 'perforated'] },
  { label: t('settings.appearance.theme.backgroundGroups.ambient'), ids: ['aurora', 'horizon', 'glow', 'mesh', 'elevation'] },
  { label: t('settings.appearance.theme.backgroundGroups.refractive'), ids: ['prism', 'spectrum', 'spectrum-x', 'spectrum-plus', 'eclipse'] },
])

function handleLightTheme() {
  if (themeStore.theme === 'dark') themeStore.toggleTheme()
}

function handleDarkTheme() {
  if (themeStore.theme === 'light') themeStore.toggleTheme()
}

function resetBrightness() {
  themeStore.setBrightness(0)
}

function handleBrightnessInput(event: Event) {
  themeStore.setBrightness(Number((event.target as HTMLInputElement).value))
}
</script>

<template>
  <div class="space-y-6">
    <AppearancePreferenceStorage />

    <div>
      <p class="settings-group-label">{{ t('settings.appearance.theme.title') }}</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border shadow-xs">
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div>
            <p class="settings-label">{{ t('settings.appearance.theme.colorScheme.label') }}</p>
            <p class="settings-hint">{{ t('settings.appearance.theme.colorScheme.hint') }}</p>
          </div>
          <div class="flex items-center gap-1 p-1 rounded-lg border border-border bg-muted/50 self-start">
            <button
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              :class="themeStore.theme === 'light' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="handleLightTheme"
            >
              <Sun :size="12" /> {{ t('settings.appearance.themeMode.light') }}
            </button>
            <button
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              :class="themeStore.theme === 'dark' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="handleDarkTheme"
            >
              <Moon :size="12" /> {{ t('settings.appearance.themeMode.dark') }}
            </button>
          </div>
        </div>

        <div class="px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <p class="settings-label mb-0.5">{{ t('settings.appearance.theme.accentColor.label') }}</p>
          <p class="text-xs text-muted-foreground mb-3">{{ t('settings.appearance.theme.accentColor.hint') }}</p>
          <div class="space-y-2">
            <div class="flex items-center gap-1.5 flex-wrap">
              <Tooltip v-for="opt in ACCENT_VIVID" :key="opt.id">
                <TooltipTrigger as-child>
                  <button
                    class="w-7 h-7 md:w-5 md:h-5 rounded-full transition-all hover:scale-110 focus:outline-none shrink-0"
                    :style="{
                      backgroundColor: opt.color,
                      outline: themeStore.accent === opt.id ? `2px solid ${opt.color}` : 'none',
                      outlineOffset: '2px',
                      transform: themeStore.accent === opt.id ? 'scale(1.25)' : '',
                    }"
                    @click="themeStore.setAccent(opt.id)"
                  />
                </TooltipTrigger>
                <TooltipContent>{{ opt.label }}</TooltipContent>
              </Tooltip>
            </div>
            <div class="flex items-center gap-1.5 flex-wrap">
              <Tooltip v-for="opt in ACCENT_PASTEL" :key="opt.id">
                <TooltipTrigger as-child>
                  <button
                    class="w-7 h-7 md:w-5 md:h-5 rounded-full transition-all hover:scale-110 focus:outline-none shrink-0"
                    :style="{
                      backgroundColor: opt.color,
                      outline: themeStore.accent === opt.id ? `2px solid ${opt.color}` : 'none',
                      outlineOffset: '2px',
                      transform: themeStore.accent === opt.id ? 'scale(1.25)' : '',
                    }"
                    @click="themeStore.setAccent(opt.id)"
                  />
                </TooltipTrigger>
                <TooltipContent>{{ opt.label }}</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>

        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div>
            <p class="settings-label">{{ t('settings.appearance.theme.cornerRadius.label') }}</p>
            <p class="settings-hint">{{ t('settings.appearance.theme.cornerRadius.hint') }}</p>
          </div>
          <div class="flex items-center gap-1.5 self-start">
            <button
              v-for="opt in RADIUS_OPTIONS"
              :key="opt.id"
              class="h-7 px-3 text-xs border-2 transition-colors font-medium"
              :style="{ borderRadius: opt.id === 'sharp' ? '2px' : opt.id === 'default' ? '6px' : opt.id === 'rounded' ? '14px' : '999px' }"
              :class="
                themeStore.radius === opt.id
                  ? 'border-primary text-primary bg-primary/8'
                  : 'border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground'
              "
              @click="themeStore.setRadius(opt.id)"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>

        <div v-if="themeStore.theme === 'dark'" class="px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div class="mb-3">
            <div class="flex items-center justify-between gap-3 mb-0.5">
              <p class="settings-label">{{ t('settings.appearance.theme.surfaceBrightness.label') }}</p>
              <div class="flex items-center gap-2">
                <span class="settings-value md:hidden">{{ themeStore.brightness }}%</span>
                <button
                  v-if="themeStore.brightness > 0"
                  class="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  @click="resetBrightness"
                >
                  {{ t('settings.appearance.theme.surfaceBrightness.reset') }}
                </button>
              </div>
            </div>
            <p class="settings-hint">{{ t('settings.appearance.theme.surfaceBrightness.hint') }}</p>
            <div>
              <span class="settings-value hidden md:inline">{{ themeStore.brightness }}%</span>
            </div>
          </div>
          <input
            :value="themeStore.brightness"
            type="range"
            min="0"
            max="100"
            step="5"
            class="w-full accent-primary cursor-pointer"
            @input="handleBrightnessInput"
          />
        </div>
      </div>
    </div>

    <div>
      <p class="settings-group-label">{{ t('settings.appearance.theme.libraryBackground.title') }}</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border shadow-xs">
        <div class="px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div class="mb-3">
            <div>
              <p class="settings-label">{{ t('settings.appearance.theme.libraryBackground.pattern.label') }}</p>
              <p class="settings-hint">{{ t('settings.appearance.theme.libraryBackground.pattern.hint') }}</p>
            </div>
          </div>
          <div class="space-y-5 md:space-y-6">
            <div v-for="group in backgroundGroups" :key="group.label">
              <p class="text-[10px] font-bold text-muted-foreground/80 uppercase tracking-widest mb-2.5 ml-0.5">{{ group.label }}</p>
              <div
                class="flex items-center gap-3 md:gap-4 overflow-x-auto md:overflow-visible md:flex-wrap pb-1 pt-0.5 px-0.5 md:pt-0 md:px-0 md:pb-0 no-scrollbar"
              >
                <Tooltip v-for="opt in BACKGROUND_OPTIONS.filter((o) => group.ids.includes(o.id))" :key="opt.id">
                  <TooltipTrigger as-child>
                    <button
                      type="button"
                      class="w-14 h-10 rounded overflow-hidden transition-all ring-2 focus:outline-none shrink-0"
                      :class="
                        themeStore.background === opt.id ? 'ring-primary shadow-xs shadow-primary/20' : 'ring-border hover:ring-muted-foreground/40'
                      "
                      @click="themeStore.setBackground(opt.id)"
                    >
                      <div class="w-full h-full bg-background [transform:translate(0)] pattern-preview" :class="opt.cssClass" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{{ opt.label }}</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
