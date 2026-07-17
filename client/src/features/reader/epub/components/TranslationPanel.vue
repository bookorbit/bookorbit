<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Copy, RefreshCw } from '@lucide/vue'
import type { SupportedLanguage, TranslationResult } from '../services/translation.types'

const { t } = useI18n()

const props = defineProps<{
  originalText: string
  loading: boolean
  error: string | null
  result: TranslationResult | null
  targetLang: string
  languages: SupportedLanguage[]
}>()

const emit = defineEmits<{
  changeLanguage: [code: string]
  retry: []
  copy: []
}>()

const selectedLangName = computed(() => props.languages.find((l) => l.code === props.targetLang)?.name ?? props.targetLang)

function handleLangChange(event: Event) {
  emit('changeLanguage', (event.target as HTMLSelectElement).value)
}
</script>

<template>
  <div class="p-4 flex flex-col gap-3 min-w-0">
    <!-- Original text -->
    <div>
      <p class="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">{{ t('reader.translation.original') }}</p>
      <div class="max-h-20 overflow-y-auto">
        <p class="text-sm text-foreground/70 leading-relaxed break-words">{{ originalText }}</p>
      </div>
    </div>

    <div class="border-t border-border" />

    <!-- Translation area -->
    <div>
      <p class="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">{{ t('reader.translation.translation') }}</p>

      <div v-if="loading" class="flex items-center gap-2 py-2">
        <div class="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin shrink-0" />
        <span class="text-sm text-muted-foreground">{{ t('reader.translation.translating') }}</span>
      </div>

      <div v-else-if="error" class="py-2">
        <p class="text-sm text-destructive mb-2">{{ error }}</p>
        <button class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors" @click="emit('retry')">
          <RefreshCw :size="12" />
          {{ t('reader.retry') }}
        </button>
      </div>

      <div v-else-if="result" class="max-h-32 overflow-y-auto">
        <p class="text-sm text-foreground leading-relaxed break-words">{{ result.translatedText }}</p>
      </div>

      <div v-else class="py-2">
        <p class="text-sm text-muted-foreground italic">{{ t('reader.translation.noTranslation') }}</p>
      </div>
    </div>

    <!-- Bottom row: language selector | provider chip | copy button -->
    <div class="flex items-center gap-2 pt-1 border-t border-border">
      <select
        class="flex-1 text-xs bg-muted text-foreground rounded px-2 py-1 border border-border focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer min-w-0 truncate"
        :value="targetLang"
        :title="selectedLangName"
        @change="handleLangChange"
      >
        <option v-for="lang in languages" :key="lang.code" :value="lang.code">{{ lang.name }}</option>
      </select>

      <span v-if="result" class="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium bg-secondary text-secondary-foreground whitespace-nowrap">
        {{ t('reader.translation.viaProvider', { provider: result.provider }) }}
      </span>

      <button
        v-if="result"
        class="shrink-0 flex items-center justify-center w-7 h-7 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
        :title="t('reader.translation.copyTranslation')"
        @click="emit('copy')"
      >
        <Copy :size="14" />
      </button>
    </div>
  </div>
</template>
