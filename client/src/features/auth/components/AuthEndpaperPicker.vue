<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ENDPAPER_IDS, endpaperLabelKey, type Endpaper } from '../lib/endpapers'
import { useEndpaper } from '../composables/useEndpaper'
import AuthEndpaper from './AuthEndpaper.vue'

const { t } = useI18n()
const { endpaper, setEndpaper } = useEndpaper()

function handleSelect(id: Endpaper) {
  setEndpaper(id)
}
</script>

<template>
  <div class="grid grid-cols-4 gap-2">
    <Tooltip v-for="id in ENDPAPER_IDS" :key="id">
      <TooltipTrigger as-child>
        <button
          type="button"
          class="rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          :aria-label="t(endpaperLabelKey(id))"
          :aria-pressed="endpaper === id"
          :data-endpaper="id"
          @click="handleSelect(id)"
        >
          <AuthEndpaper
            :pattern="id"
            :scale="0.5"
            class="h-11 w-full overflow-hidden rounded-[5px] ring-2 transition-shadow"
            :class="endpaper === id ? 'ring-primary' : 'ring-border hover:ring-muted-foreground/40'"
          />
        </button>
      </TooltipTrigger>
      <TooltipContent>{{ t(endpaperLabelKey(id)) }}</TooltipContent>
    </Tooltip>
  </div>
</template>
