<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Check } from '@lucide/vue'
import { GLOW_TEXTURES, type GlowTextureOption } from '@/lib/theme-styles'
import { useThemeStore } from '@/stores/theme'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const { t } = useI18n()
const themeStore = useThemeStore()
/** Compact tiles carry no name, for menus too narrow for one under each; the menu names the current pick. */
const props = withDefaults(defineProps<{ compact?: boolean; touch?: boolean }>(), {
  compact: false,
  touch: false,
})

function selectTexture(texture: GlowTextureOption) {
  themeStore.setGlowTexture(texture.id)
}

function tileClass(texture: GlowTextureOption) {
  return themeStore.glowTexture === texture.id ? 'outline-2 outline-primary' : 'outline-2 outline-transparent group-hover:outline-border'
}
</script>

<template>
  <div
    v-if="props.compact"
    class="grid grid-cols-4"
    :class="props.touch ? 'gap-2.5' : 'gap-2'"
    role="group"
    :aria-label="t('settings.appearance.theme.glowTexture.label')"
  >
    <Tooltip v-for="texture in GLOW_TEXTURES" :key="texture.id">
      <TooltipTrigger as-child>
        <button
          type="button"
          class="group block rounded-md focus:outline-none"
          :aria-label="t(texture.labelKey)"
          :aria-pressed="themeStore.glowTexture === texture.id"
          @click="selectTexture(texture)"
        >
          <span
            class="glow-texture-tile block aspect-[3/2] w-full rounded-md border border-border outline-offset-2 transition-[outline-color] group-focus-visible:ring-2 group-focus-visible:ring-ring"
            :class="tileClass(texture)"
            :data-glow-texture="texture.id"
            aria-hidden="true"
          />
        </button>
      </TooltipTrigger>
      <TooltipContent>{{ t(texture.labelKey) }}</TooltipContent>
    </Tooltip>
  </div>

  <div v-else class="grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-4" role="group" :aria-label="t('settings.appearance.theme.glowTexture.label')">
    <button
      v-for="texture in GLOW_TEXTURES"
      :key="texture.id"
      type="button"
      class="group flex min-w-0 flex-col gap-1.5 rounded-md text-start focus:outline-none"
      :aria-label="t(texture.labelKey)"
      :aria-pressed="themeStore.glowTexture === texture.id"
      @click="selectTexture(texture)"
    >
      <!-- The top of the main column in miniature, painted from the same tokens as the page's own glow. -->
      <span
        class="glow-texture-tile block aspect-[5/2] w-full rounded-md border border-border outline-offset-2 transition-[outline-color] group-focus-visible:ring-2 group-focus-visible:ring-ring"
        :class="tileClass(texture)"
        :data-glow-texture="texture.id"
        aria-hidden="true"
      >
        <span
          v-if="themeStore.glowTexture === texture.id"
          class="absolute top-1 left-1 z-10 flex size-3.5 items-center justify-center rounded-full bg-primary text-primary-foreground"
        >
          <Check :size="10" :stroke-width="3" />
        </span>
      </span>
      <span class="text-xs" :class="themeStore.glowTexture === texture.id ? 'font-medium text-primary' : 'text-foreground'">
        {{ t(texture.labelKey) }}
      </span>
    </button>
  </div>
</template>
