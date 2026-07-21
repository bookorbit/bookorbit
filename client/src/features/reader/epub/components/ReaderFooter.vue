<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronLeft, ChevronRight, ChevronsUpDown } from '@lucide/vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const { t } = useI18n()

const props = defineProps<{
  fraction: number
  sectionIndex: number
  totalSections: number
  sectionFractions: number[]
  chapterStartFraction: number
  chapterEndFraction: number
  locationTotal: number
}>()

const emit = defineEmits<{
  prevSection: []
  nextSection: []
  seek: [fraction: number]
}>()

const showGoToInput = ref(false)
const goToValue = ref('')
const goToInputRef = ref<HTMLInputElement | null>(null)

function onSeek(e: Event) {
  const input = e.target as HTMLInputElement
  emit('seek', Number(input.value))
}

function handlePercentageClick() {
  showGoToInput.value = true
  goToValue.value = ''
  setTimeout(() => goToInputRef.value?.focus(), 0)
}

function handleGoToSubmit() {
  const raw = goToValue.value.trim()
  if (!raw) {
    showGoToInput.value = false
    return
  }

  if (raw.toLowerCase().startsWith('p') && props.locationTotal > 0) {
    const page = parseInt(raw.slice(1), 10)
    if (!isNaN(page) && page >= 1 && page <= props.locationTotal) {
      emit('seek', (page - 1) / props.locationTotal)
    }
  } else {
    const pct = parseFloat(raw)
    if (!isNaN(pct) && pct >= 0 && pct <= 100) {
      emit('seek', pct / 100)
    }
  }

  showGoToInput.value = false
}

function handleGoToKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    showGoToInput.value = false
  }
}

function handleGoToBlur() {
  showGoToInput.value = false
}
</script>

<template>
  <footer
    class="fixed bottom-0 left-0 right-0 h-10 sm:h-11 z-50 flex items-center gap-2 px-2 sm:gap-3 sm:px-4 bg-background/90 backdrop-blur-md border-t border-border"
  >
    <Tooltip>
      <TooltipTrigger as-child>
        <button
          type="button"
          :aria-label="t('reader.footer.previousSection')"
          class="viewer-btn"
          :disabled="sectionIndex === 0"
          @click="emit('prevSection')"
        >
          <ChevronLeft :size="18" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{{ t('reader.footer.previousSection') }}</TooltipContent>
    </Tooltip>

    <div class="relative flex-1 flex items-center h-6">
      <!-- Chapter highlight segment -->
      <div
        v-if="chapterStartFraction < chapterEndFraction"
        class="absolute top-1/2 -translate-y-1/2 h-2.5 rounded-full pointer-events-none"
        :style="{
          left: `${chapterStartFraction * 100}%`,
          width: `${(chapterEndFraction - chapterStartFraction) * 100}%`,
          background: 'color-mix(in oklch, var(--primary) 25%, transparent)',
        }"
      />

      <input
        type="range"
        min="0"
        max="1"
        step="0.001"
        :value="fraction"
        @input="onSeek"
        class="w-full h-1 rounded-full appearance-none cursor-pointer relative z-10"
        :style="{
          accentColor: 'var(--primary)',
          background: `linear-gradient(to right, var(--primary) ${fraction * 100}%, var(--border) ${fraction * 100}%)`,
        }"
      />
      <template v-for="(sf, idx) in sectionFractions" :key="idx">
        <div
          v-if="sf > 0 && sf < 1"
          class="absolute top-1/2 -translate-y-1/2 w-px h-3 pointer-events-none z-10"
          :style="{ left: `${sf * 100}%`, background: 'var(--muted-foreground)' }"
        />
      </template>
    </div>

    <template v-if="showGoToInput">
      <input
        ref="goToInputRef"
        v-model="goToValue"
        type="text"
        :placeholder="t('reader.footer.goToPlaceholder')"
        class="w-24 h-8 text-sm tabular-nums text-center bg-muted border border-border rounded px-2 py-1 text-foreground outline-none focus:ring-1 focus:ring-primary"
        @keydown.enter="handleGoToSubmit"
        @keydown="handleGoToKeydown"
        @blur="handleGoToBlur"
      />
    </template>
    <template v-else>
      <Tooltip>
        <TooltipTrigger as-child>
          <button
            type="button"
            :aria-label="t('reader.footer.jumpToLocation')"
            class="h-8 px-2 rounded-md border border-transparent hover:border-border text-xs tabular-nums shrink-0 min-w-18 text-center text-muted-foreground hover:text-foreground transition-colors inline-flex items-center justify-center gap-1"
            @click="handlePercentageClick"
          >
            <span class="text-[11px] uppercase tracking-wide">{{ t('reader.footer.go') }}</span>
            <span>{{ Math.round(fraction * 100) }}%</span>
            <ChevronsUpDown :size="12" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{{ t('reader.footer.jumpTooltip') }}</TooltipContent>
      </Tooltip>
    </template>

    <Tooltip>
      <TooltipTrigger as-child>
        <button
          type="button"
          :aria-label="t('reader.footer.nextSection')"
          class="viewer-btn"
          :disabled="totalSections > 0 && sectionIndex >= totalSections - 1"
          @click="emit('nextSection')"
        >
          <ChevronRight :size="18" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{{ t('reader.footer.nextSection') }}</TooltipContent>
    </Tooltip>
  </footer>
</template>
