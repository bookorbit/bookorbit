<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { PATTERN_TOKENS, type PatternToken } from '@bookorbit/types'
import { PATTERN_MODIFIERS, type PatternModifier } from '../lib/pattern-highlight'

const emit = defineEmits<{ insert: [text: string, caretOffset?: number] }>()

const { t } = useI18n()

// Written out rather than derived from the token name so a renamed message key fails
// the locale check instead of silently rendering the raw key.
const TOKEN_DESCRIPTION_KEYS: Record<PatternToken, string> = {
  title: 'settings.reader.fileNaming.tokenTitle',
  subtitle: 'settings.reader.fileNaming.tokenSubtitle',
  authors: 'settings.reader.fileNaming.tokenAuthors',
  narrators: 'settings.reader.fileNaming.tokenNarrators',
  year: 'settings.reader.fileNaming.tokenYear',
  series: 'settings.reader.fileNaming.tokenSeries',
  seriesIndex: 'settings.reader.fileNaming.tokenSeriesIndex',
  publisher: 'settings.reader.fileNaming.tokenPublisher',
  isbn: 'settings.reader.fileNaming.tokenIsbn',
  language: 'settings.reader.fileNaming.tokenLanguage',
  library: 'settings.reader.fileNaming.tokenLibrary',
  originalFilename: 'settings.reader.fileNaming.tokenOriginalFilename',
  extension: 'settings.reader.fileNaming.tokenExtension',
}

const MODIFIER_DESCRIPTION_KEYS: Record<PatternModifier, string> = {
  first: 'settings.reader.fileNaming.modFirst',
  sort: 'settings.reader.fileNaming.modSort',
  initial: 'settings.reader.fileNaming.modInitial',
  fixed2: 'settings.reader.fileNaming.modFixed2',
  max3: 'settings.reader.fileNaming.modMax3',
  upper: 'settings.reader.fileNaming.modUpper',
  lower: 'settings.reader.fileNaming.modLower',
}

const tokens = computed(() => PATTERN_TOKENS.map((entry) => ({ text: `{${entry.token}}`, description: t(TOKEN_DESCRIPTION_KEYS[entry.token]) })))

const modifiers = computed(() => PATTERN_MODIFIERS.map((modifier) => ({ text: `:${modifier}`, description: t(MODIFIER_DESCRIPTION_KEYS[modifier]) })))

function insertToken(text: string) {
  emit('insert', text)
}

function insertModifier(text: string) {
  emit('insert', text)
}

function insertOptional() {
  // Caret lands inside the brackets, which is where the next keystroke belongs.
  emit('insert', '<>', 1)
}

function insertFallback() {
  emit('insert', '|')
}

function insertSeparator() {
  emit('insert', '/')
}
</script>

<template>
  <div class="rounded-md border border-border bg-muted/30">
    <div class="flex flex-col gap-1 px-3 py-2.5 sm:flex-row sm:gap-3">
      <span class="w-20 shrink-0 pt-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {{ t('settings.reader.fileNaming.tokens') }}
      </span>
      <div class="flex flex-wrap gap-1">
        <button
          v-for="token in tokens"
          :key="token.text"
          type="button"
          :title="token.description"
          class="inline-flex h-6 items-center rounded-[5px] border border-pattern-token/30 bg-pattern-token/10 px-1.5 font-mono text-[11px] font-semibold text-pattern-token transition-colors hover:bg-pattern-token/20 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
          @click="insertToken(token.text)"
        >
          {{ token.text }}
        </button>
      </div>
    </div>

    <div class="flex flex-col gap-1 border-t border-border/70 px-3 py-2.5 sm:flex-row sm:gap-3">
      <span class="w-20 shrink-0 pt-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {{ t('settings.reader.fileNaming.modifiers') }}
      </span>
      <div class="flex flex-wrap gap-1">
        <button
          v-for="modifier in modifiers"
          :key="modifier.text"
          type="button"
          :title="modifier.description"
          class="inline-flex h-6 items-center rounded-[5px] border border-pattern-modifier/30 bg-pattern-modifier/10 px-1.5 font-mono text-[11px] font-semibold text-pattern-modifier transition-colors hover:bg-pattern-modifier/20 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
          @click="insertModifier(modifier.text)"
        >
          {{ modifier.text }}
        </button>
      </div>
    </div>

    <div class="flex flex-col gap-1 border-t border-border/70 px-3 py-2.5 sm:flex-row sm:gap-3">
      <span class="w-20 shrink-0 pt-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {{ t('settings.reader.fileNaming.structure') }}
      </span>
      <div class="flex flex-wrap gap-1">
        <button
          type="button"
          :title="t('settings.reader.fileNaming.paletteOptionalHint')"
          class="inline-flex h-6 items-center rounded-[5px] border border-pattern-optional/35 bg-pattern-optional/10 px-1.5 font-mono text-[11px] font-semibold text-pattern-optional transition-colors hover:bg-pattern-optional/20 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
          @click="insertOptional"
        >
          {{ t('settings.reader.fileNaming.paletteOptional') }}
        </button>
        <button
          type="button"
          :title="t('settings.reader.fileNaming.paletteFallbackHint')"
          class="inline-flex h-6 items-center rounded-[5px] border border-pattern-fallback/35 bg-pattern-fallback/10 px-1.5 font-mono text-[11px] font-semibold text-pattern-fallback transition-colors hover:bg-pattern-fallback/20 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
          @click="insertFallback"
        >
          {{ t('settings.reader.fileNaming.paletteFallback') }}
        </button>
        <button
          type="button"
          :title="t('settings.reader.fileNaming.paletteSeparatorHint')"
          class="inline-flex h-6 items-center rounded-[5px] border border-border bg-background px-1.5 font-mono text-[11px] font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
          @click="insertSeparator"
        >
          {{ t('settings.reader.fileNaming.paletteSeparator') }}
        </button>
      </div>
    </div>
  </div>
</template>
