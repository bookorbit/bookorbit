<script setup lang="ts">
import { computed, ref, type HTMLAttributes } from 'vue'
import { useI18n } from 'vue-i18n'
import { Palette } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import AccentPicker from '@/components/AccentPicker.vue'
import BackgroundPicker from '@/components/BackgroundPicker.vue'
import GlowReachPicker from '@/components/GlowReachPicker.vue'
import RadiusPicker from '@/components/RadiusPicker.vue'
import StylePicker from '@/components/StylePicker.vue'
import SurfaceBrightnessPicker from '@/components/SurfaceBrightnessPicker.vue'
import SurfaceOpacityPicker from '@/components/SurfaceOpacityPicker.vue'
import SurfacePalettePicker from '@/components/SurfacePalettePicker.vue'
import ThemePicker from '@/components/ThemePicker.vue'
import { ACCENT_OPTIONS } from '@/lib/theme-accent-meta'
import { BACKGROUND_OPTIONS, RADIUS_OPTIONS, useThemeStore } from '@/stores/theme'

defineProps<{
  controlClass: HTMLAttributes['class']
  isMobile: boolean
  isRail: boolean
  /** The dock row: the panel opens past the sidebar's edge instead of over it. */
  anchor?: HTMLElement | null
}>()

const { t } = useI18n()
const themeStore = useThemeStore()
const showSurfaceOpacity = computed(() => themeStore.appearanceControls.surfaceOpacity)
const showSurfaceBrightness = computed(() => themeStore.resolvedTheme === 'dark' && themeStore.appearanceControls.brightness)

// Swatches and pattern tiles carry no text, so each section names its current pick.
const accentLabel = computed(() => {
  const option = ACCENT_OPTIONS.find((candidate) => candidate.id === themeStore.accent)
  return option ? t(option.labelKey) : ''
})
const backgroundLabel = computed(() => {
  const option = BACKGROUND_OPTIONS.find((candidate) => candidate.id === themeStore.background)
  return option ? t(option.labelKey) : ''
})
const radiusLabel = computed(() => {
  const option = RADIUS_OPTIONS.find((candidate) => candidate.id === themeStore.radius)
  return option ? t(option.labelKey) : ''
})

const sheetOpen = ref(false)

function openSheet() {
  sheetOpen.value = true
}
</script>

<template>
  <Tooltip v-if="isMobile">
    <TooltipTrigger as-child>
      <Button variant="ghost" size="icon" :class="controlClass" :aria-label="t('components.appHeader.appearance')" @click="openSheet">
        <Palette :size="15" aria-hidden="true" />
      </Button>
    </TooltipTrigger>
    <TooltipContent side="top">{{ t('components.appHeader.appearance') }}</TooltipContent>
  </Tooltip>

  <Tooltip v-else>
    <Popover>
      <TooltipTrigger as-child>
        <PopoverTrigger as-child>
          <Button data-tour="appearance-picker" variant="ghost" size="icon" :class="controlClass" :aria-label="t('components.appHeader.appearance')">
            <Palette :size="15" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
      </TooltipTrigger>
      <PopoverContent class="w-80 p-4" side="right" align="end" :side-offset="12" :reference="anchor ?? undefined">
        <div class="space-y-4">
          <p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground">{{ t('components.appHeader.appearance') }}</p>
          <div class="space-y-2">
            <span class="text-[13px] text-muted-foreground">{{ t('components.appHeader.theme') }}</span>
            <ThemePicker block />
          </div>
          <div class="space-y-2">
            <div class="flex items-baseline justify-between gap-2">
              <span class="text-[13px] text-muted-foreground">{{ t('components.appHeader.accent') }}</span>
              <span class="truncate text-[13px] font-medium text-foreground">{{ accentLabel }}</span>
            </div>
            <AccentPicker />
          </div>
          <div class="space-y-2">
            <span class="text-[13px] text-muted-foreground">{{ t('components.appHeader.style') }}</span>
            <StylePicker block />
          </div>
          <div v-if="themeStore.appearanceControls.surfacePalette" class="space-y-2">
            <span class="text-[13px] text-muted-foreground">{{ t('components.appHeader.surfacePalette') }}</span>
            <SurfacePalettePicker />
          </div>
          <div v-if="themeStore.appearanceControls.background" class="space-y-2">
            <div class="flex items-baseline justify-between gap-2">
              <span class="text-[13px] text-muted-foreground">{{ t('components.appHeader.background') }}</span>
              <span class="truncate text-[13px] font-medium text-foreground">{{ backgroundLabel }}</span>
            </div>
            <BackgroundPicker />
          </div>
          <div class="space-y-2">
            <div class="flex items-baseline justify-between gap-2">
              <span class="text-[13px] text-muted-foreground">{{ t('components.appHeader.radius') }}</span>
              <span class="truncate text-[13px] font-medium text-foreground">{{ radiusLabel }}</span>
            </div>
            <RadiusPicker block />
          </div>
          <!-- The sliders share one block below the choices, one row each: label, track, value. -->
          <div class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-3 border-t border-border pt-4">
            <span class="text-[13px] whitespace-nowrap text-muted-foreground">{{ t('components.appHeader.topGlow') }}</span>
            <GlowReachPicker />
            <template v-if="showSurfaceOpacity">
              <span class="text-[13px] whitespace-nowrap text-muted-foreground">{{ t('components.appHeader.surfaceOpacity') }}</span>
              <SurfaceOpacityPicker />
            </template>
            <template v-if="showSurfaceBrightness">
              <span class="text-[13px] whitespace-nowrap text-muted-foreground">{{ t('settings.appearance.theme.surfaceBrightness.label') }}</span>
              <SurfaceBrightnessPicker />
            </template>
          </div>
        </div>
      </PopoverContent>
    </Popover>
    <TooltipContent :side="isRail ? 'right' : 'top'">{{ t('components.appHeader.appearance') }}</TooltipContent>
  </Tooltip>

  <Sheet v-if="isMobile" v-model:open="sheetOpen">
    <SheetContent side="bottom" class="h-[85dvh] rounded-t-xl p-0">
      <SheetHeader class="shrink-0 border-b border-border px-4 py-3 text-start">
        <SheetTitle class="text-base">{{ t('components.appHeader.appearance') }}</SheetTitle>
        <SheetDescription class="sr-only">{{ t('components.appHeader.appearanceDescription') }}</SheetDescription>
      </SheetHeader>
      <div class="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <section class="space-y-2 rounded-lg border border-border bg-card p-3">
          <h3 class="text-sm font-medium text-foreground">{{ t('components.appHeader.theme') }}</h3>
          <ThemePicker touch />
        </section>

        <section class="space-y-2 rounded-lg border border-border bg-card p-3">
          <div class="flex items-baseline justify-between gap-2">
            <h3 class="text-sm font-medium text-foreground">{{ t('components.appHeader.accent') }}</h3>
            <span class="truncate text-[13px] text-muted-foreground">{{ accentLabel }}</span>
          </div>
          <AccentPicker touch />
        </section>

        <section class="space-y-3 rounded-lg border border-border bg-card p-3">
          <div class="space-y-2">
            <h3 class="text-sm font-medium text-foreground">{{ t('components.appHeader.style') }}</h3>
            <StylePicker touch />
          </div>
          <div v-if="themeStore.appearanceControls.surfacePalette" class="space-y-2 border-t border-border pt-3">
            <h3 class="text-sm font-medium text-foreground">{{ t('components.appHeader.surfacePalette') }}</h3>
            <SurfacePalettePicker touch />
          </div>
        </section>

        <section v-if="themeStore.appearanceControls.background" class="space-y-2 rounded-lg border border-border bg-card p-3">
          <div class="flex items-baseline justify-between gap-2">
            <h3 class="text-sm font-medium text-foreground">{{ t('components.appHeader.background') }}</h3>
            <span class="truncate text-[13px] text-muted-foreground">{{ backgroundLabel }}</span>
          </div>
          <BackgroundPicker touch />
        </section>

        <section class="space-y-2 rounded-lg border border-border bg-card p-3">
          <div class="flex items-baseline justify-between gap-2">
            <h3 class="text-sm font-medium text-foreground">{{ t('components.appHeader.radius') }}</h3>
            <span class="truncate text-[13px] text-muted-foreground">{{ radiusLabel }}</span>
          </div>
          <RadiusPicker touch />
        </section>

        <section class="space-y-3 rounded-lg border border-border bg-card p-3">
          <div class="space-y-2">
            <h3 class="text-sm font-medium text-foreground">{{ t('components.appHeader.topGlow') }}</h3>
            <GlowReachPicker />
          </div>
          <div v-if="showSurfaceOpacity" class="space-y-2 border-t border-border pt-3">
            <h3 class="text-sm font-medium text-foreground">{{ t('components.appHeader.surfaceOpacity') }}</h3>
            <SurfaceOpacityPicker />
          </div>
          <div v-if="showSurfaceBrightness" class="space-y-2 border-t border-border pt-3">
            <h3 class="text-sm font-medium text-foreground">{{ t('settings.appearance.theme.surfaceBrightness.label') }}</h3>
            <SurfaceBrightnessPicker />
          </div>
        </section>
      </div>
    </SheetContent>
  </Sheet>
</template>
