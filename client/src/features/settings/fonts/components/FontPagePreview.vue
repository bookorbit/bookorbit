<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { themes, type ThemeMode } from '@/features/reader/epub/constants/themes'

export type PreviewPaper = 'app' | 'white' | 'sepia' | 'night'

/**
 * A passage set the way the reader sets it, on the reader's own page colours. A script face that is
 * lovely on the app surface can fall apart on sepia, and this is where an administrator finds out.
 */
const props = defineProps<{
  cssFamilyName: string
  paper: PreviewPaper
}>()

const emit = defineEmits<{ 'update:paper': [paper: PreviewPaper] }>()

const { t } = useI18n()

const themeNamed = (name: string) => themes.find((theme) => theme.name === name)!

/** The reader's Default page in light and dark, and its Sepia page. */
const PAPER_COLOURS: Record<Exclude<PreviewPaper, 'app'>, ThemeMode> = {
  white: themeNamed('default').light,
  sepia: themeNamed('sepia').light,
  night: themeNamed('default').dark,
}

const PAPERS: PreviewPaper[] = ['app', 'white', 'sepia', 'night']

function swatchStyle(paper: PreviewPaper) {
  if (paper === 'app') return {}
  const mode = PAPER_COLOURS[paper]
  return { backgroundColor: mode.bg, color: mode.fg }
}

const pageStyle = computed(() => ({ ...swatchStyle(props.paper), fontFamily: `'${props.cssFamilyName}', serif` }))

function selectPaper(paper: PreviewPaper) {
  emit('update:paper', paper)
}
</script>

<template>
  <div class="flex flex-col gap-2.5">
    <div class="flex items-center justify-between gap-3">
      <span class="settings-group-label mb-0">{{ t('settings.admin.serverFonts.sheet.preview') }}</span>
      <div class="flex items-center gap-1.5" role="group" :aria-label="t('settings.admin.serverFonts.sheet.pageColour')">
        <button
          v-for="paper in PAPERS"
          :key="paper"
          type="button"
          class="grid size-[26px] place-items-center rounded-full border border-foreground/15 font-serif text-xs font-semibold transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:outline-[1.5px] aria-pressed:outline-offset-2 aria-pressed:outline-primary aria-pressed:outline-solid"
          :class="paper === 'app' ? 'bg-card text-foreground' : ''"
          :style="swatchStyle(paper)"
          :aria-pressed="paper === props.paper"
          :aria-label="t(`settings.admin.serverFonts.sheet.papers.${paper}`)"
          :title="t(`settings.admin.serverFonts.sheet.papers.${paper}`)"
          @click="selectPaper(paper)"
        >
          A
        </button>
      </div>
    </div>
    <slot />
    <div
      class="rounded-xl border border-border px-7 py-6 transition-colors"
      :class="paper === 'app' ? 'bg-card text-foreground' : ''"
      :style="pageStyle"
    >
      <p class="mb-3 text-[25px] leading-tight text-balance">{{ t('settings.admin.serverFonts.sheet.previewHeading') }}</p>
      <p class="text-lg leading-relaxed">{{ t('settings.admin.serverFonts.sheet.previewParagraph1') }}</p>
      <p class="mt-3.5 text-lg leading-relaxed">{{ t('settings.admin.serverFonts.sheet.previewParagraph2') }}</p>
    </div>
  </div>
</template>
