<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Volume1, Volume2, VolumeX } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatNumber } from '@/i18n/formatters'
import MediaScrubber from './MediaScrubber.vue'

const VOLUME_STEP = 0.05
const VOLUME_PAGE_STEP = 0.2

const props = withDefaults(defineProps<{ volume: number; variant?: 'inline' | 'popover' }>(), { variant: 'inline' })
const emit = defineEmits<{ 'update:volume': [value: number]; toggleMute: [] }>()

const { t } = useI18n()

const isMuted = computed(() => props.volume <= 0)
const stateIcon = computed(() => (isMuted.value ? VolumeX : props.volume < 0.5 ? Volume1 : Volume2))
const percentLabel = computed(() => formatNumber(props.volume, { style: 'percent', maximumFractionDigits: 0 }))
const muteLabel = computed(() => (isMuted.value ? t('components.media.unmute') : t('components.media.mute')))

function handleToggleMute() {
  emit('toggleMute')
}

function handleSeek(value: number) {
  emit('update:volume', value)
}
</script>

<template>
  <div v-if="variant === 'inline'" class="flex items-center gap-2">
    <Button
      variant="ghost"
      size="icon-sm"
      class="shrink-0 rounded-full text-muted-foreground hover:text-foreground"
      :aria-label="muteLabel"
      :aria-pressed="isMuted"
      @click="handleToggleMute"
    >
      <component :is="stateIcon" :size="16" />
    </Button>
    <MediaScrubber
      class="min-w-24 flex-1"
      size="sm"
      continuous
      :current="volume"
      :duration="1"
      :step="VOLUME_STEP"
      :page-step="VOLUME_PAGE_STEP"
      :ariaLabel="t('components.media.volume')"
      :ariaValueText="percentLabel"
      @seek="handleSeek"
    />
    <span class="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{{ percentLabel }}</span>
  </div>

  <Popover v-else>
    <PopoverTrigger as-child>
      <Button variant="ghost" size="icon" class="rounded-full text-muted-foreground hover:text-foreground" :aria-label="t('components.media.volume')">
        <component :is="stateIcon" :size="16" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" class="w-60 p-3">
      <div class="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          class="shrink-0 rounded-full text-muted-foreground hover:text-foreground"
          :aria-label="muteLabel"
          :aria-pressed="isMuted"
          @click="handleToggleMute"
        >
          <component :is="stateIcon" :size="16" />
        </Button>
        <MediaScrubber
          class="min-w-20 flex-1"
          size="sm"
          continuous
          :current="volume"
          :duration="1"
          :step="VOLUME_STEP"
          :page-step="VOLUME_PAGE_STEP"
          :ariaLabel="t('components.media.volume')"
          :ariaValueText="percentLabel"
          @seek="handleSeek"
        />
        <span class="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{{ percentLabel }}</span>
      </div>
    </PopoverContent>
  </Popover>
</template>
