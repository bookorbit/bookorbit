<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ClipboardCopy } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { PATTERN_TOKENS, type PatternToken } from '@bookorbit/types'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { copyToClipboard } from '@/lib/clipboard'

defineProps<{ open: boolean }>()

const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const { t } = useI18n()

type HelpTab = 'tokens' | 'modifiers' | 'examples'

const activeTab = ref<HelpTab>('tokens')

const TABS = computed(() => [
  { id: 'tokens' as const, label: t('settings.reader.fileNaming.tokens') },
  { id: 'modifiers' as const, label: t('settings.reader.fileNaming.modifiers') },
  { id: 'examples' as const, label: t('settings.reader.fileNaming.examples') },
])

const TOKEN_DESCRIPTIONS = computed<Record<PatternToken, string>>(() => ({
  title: t('settings.reader.fileNaming.tokenTitle'),
  subtitle: t('settings.reader.fileNaming.tokenSubtitle'),
  authors: t('settings.reader.fileNaming.tokenAuthors'),
  year: t('settings.reader.fileNaming.tokenYear'),
  series: t('settings.reader.fileNaming.tokenSeries'),
  seriesIndex: t('settings.reader.fileNaming.tokenSeriesIndex'),
  publisher: t('settings.reader.fileNaming.tokenPublisher'),
  isbn: t('settings.reader.fileNaming.tokenIsbn'),
  language: t('settings.reader.fileNaming.tokenLanguage'),
  originalFilename: t('settings.reader.fileNaming.tokenOriginalFilename'),
  extension: t('settings.reader.fileNaming.tokenExtension'),
}))

const MODIFIERS = computed(() => [
  { key: ':first', description: t('settings.reader.fileNaming.modFirst') },
  { key: ':sort', description: t('settings.reader.fileNaming.modSort') },
  { key: ':initial', description: t('settings.reader.fileNaming.modInitial') },
  { key: ':fixed2', description: t('settings.reader.fileNaming.modFixed2') },
  { key: ':upper', description: 'UPPERCASE' },
  { key: ':lower', description: 'lowercase' },
])

const EXAMPLES = computed(() => [
  {
    label: t('settings.reader.fileNaming.exCalibre'),
    pattern: '{authors}/{title}< ({year})>',
    cases: [
      { label: t('settings.reader.fileNaming.caseWithYear'), result: 'William Gibson/Neuromancer (1984).epub' },
      { label: t('settings.reader.fileNaming.caseNoYear'), result: 'William Gibson/Neuromancer.epub' },
    ],
  },
  {
    label: t('settings.reader.fileNaming.exSeriesReader'),
    pattern: '{authors:first}/<{series}/><{seriesIndex}. >{title}',
    cases: [
      { label: t('settings.reader.fileNaming.caseInSeries'), result: 'William Gibson/Sprawl/01. Neuromancer.epub' },
      { label: t('settings.reader.fileNaming.caseStandalone'), result: 'William Gibson/Neuromancer.epub' },
    ],
  },
  {
    label: t('settings.reader.fileNaming.exCleanDownload'),
    pattern: '{authors:first} - {title}< ({year})>',
    cases: [
      { label: t('settings.reader.fileNaming.caseWithYear'), result: 'William Gibson - Neuromancer (1984).epub' },
      { label: t('settings.reader.fileNaming.caseNoYear'), result: 'William Gibson - Neuromancer.epub' },
    ],
  },
  {
    label: t('settings.reader.fileNaming.exAlphabetical'),
    pattern: '{authors:initial}/{authors:sort}/<{series}/><{seriesIndex}. >{title}',
    cases: [
      { label: t('settings.reader.fileNaming.caseInSeries'), result: 'G/Gibson, William/Sprawl/01. Neuromancer.epub' },
      { label: t('settings.reader.fileNaming.caseStandalone'), result: 'G/Gibson, William/Neuromancer.epub' },
    ],
  },
  {
    label: t('settings.reader.fileNaming.exSeriesFallback'),
    pattern: '<{series}|Standalone>/<{seriesIndex}. >{title}',
    cases: [
      { label: t('settings.reader.fileNaming.caseInSeries'), result: 'Sprawl/01. Neuromancer.epub' },
      { label: t('settings.reader.fileNaming.caseNoSeries'), result: 'Standalone/Neuromancer.epub' },
    ],
  },
  {
    label: t('settings.reader.fileNaming.exOptionalSubtitle'),
    pattern: '{authors:first} - {title}< - {subtitle}>< ({year})>',
    cases: [
      {
        label: t('settings.reader.fileNaming.caseFull'),
        result: 'Andrew Hunt - The Pragmatic Programmer - From Journeyman to Master (1999).epub',
      },
      { label: t('settings.reader.fileNaming.caseMinimal'), result: 'Andrew Hunt - The Pragmatic Programmer.epub' },
    ],
  },
  {
    label: t('settings.reader.fileNaming.exMultilingual'),
    pattern: '<{language:upper}/>{authors}/{title}',
    cases: [
      { label: t('settings.reader.fileNaming.caseWithLanguage'), result: 'EN/William Gibson/Neuromancer.epub' },
      { label: t('settings.reader.fileNaming.caseNoLanguage'), result: 'William Gibson/Neuromancer.epub' },
    ],
  },
  {
    label: t('settings.reader.fileNaming.exPublisher'),
    pattern: '<{publisher}/>{authors:first}/{title}',
    cases: [
      { label: t('settings.reader.fileNaming.caseWithPublisher'), result: "O'Reilly/Andrew Hunt/The Pragmatic Programmer.epub" },
      { label: t('settings.reader.fileNaming.caseNoPublisher'), result: 'Andrew Hunt/The Pragmatic Programmer.epub' },
    ],
  },
  {
    label: t('settings.reader.fileNaming.exStacked'),
    pattern: '<{language:upper}/><{publisher}|Unknown Publisher>/{authors:first}/{title}',
    cases: [
      { label: t('settings.reader.fileNaming.caseAllSet'), result: "EN/O'Reilly/Andrew Hunt/The Pragmatic Programmer.epub" },
      { label: t('settings.reader.fileNaming.caseNoLanguage'), result: "O'Reilly/Andrew Hunt/The Pragmatic Programmer.epub" },
      { label: t('settings.reader.fileNaming.caseNoPublisher'), result: 'Unknown Publisher/Andrew Hunt/The Pragmatic Programmer.epub' },
    ],
  },
  {
    label: t('settings.reader.fileNaming.exFolderDrop'),
    pattern: '{authors:initial}/{authors:sort}/<{series}/>',
    cases: [
      { label: t('settings.reader.fileNaming.caseInSeries'), result: 'G/Gibson, William/Sprawl/neuromancer.epub' },
      { label: t('settings.reader.fileNaming.caseStandalone'), result: 'G/Gibson, William/neuromancer.epub' },
    ],
  },
])

function tokenLabel(token: string): string {
  return `{${token}}`
}

function selectTab(tab: HelpTab) {
  activeTab.value = tab
}

function handleOpenChange(value: boolean) {
  emit('update:open', value)
}

async function copyToken(token: string) {
  const value = `{${token}}`
  const copied = await copyToClipboard(value)
  if (copied) {
    toast.success(t('settings.reader.fileNaming.copiedToClipboard', { value }))
  } else {
    toast.error(t('settings.reader.fileNaming.copyTokenFailed'))
  }
}

async function copyPattern(pattern: string) {
  const copied = await copyToClipboard(pattern)
  if (copied) {
    toast.success(t('settings.reader.fileNaming.patternCopied'))
  } else {
    toast.error(t('settings.reader.fileNaming.copyPatternFailed'))
  }
}
</script>

<template>
  <Sheet :open="open" @update:open="handleOpenChange">
    <SheetContent side="right" class="w-full gap-0 sm:max-w-2xl">
      <SheetHeader class="border-b border-border pr-10">
        <SheetTitle>{{ t('settings.reader.fileNaming.patternHelp') }}</SheetTitle>
        <SheetDescription>{{ t('settings.reader.fileNaming.patternHelpDescription') }}</SheetDescription>
      </SheetHeader>

      <div class="flex gap-1 border-b border-border px-4" role="tablist" :aria-label="t('settings.reader.fileNaming.patternHelp')">
        <button
          v-for="tab in TABS"
          :key="tab.id"
          :id="`pattern-help-tab-${tab.id}`"
          type="button"
          role="tab"
          :aria-selected="activeTab === tab.id"
          :aria-controls="`pattern-help-panel-${tab.id}`"
          :tabindex="activeTab === tab.id ? 0 : -1"
          class="-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :class="activeTab === tab.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'"
          @click="selectTab(tab.id)"
        >
          {{ tab.label }}
        </button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto p-4">
        <div v-if="activeTab === 'tokens'" id="pattern-help-panel-tokens" role="tabpanel" aria-labelledby="pattern-help-tab-tokens" class="space-y-3">
          <p class="settings-hint mt-0">{{ t('settings.reader.fileNaming.clickTokenHint') }}</p>
          <ul class="divide-y divide-border rounded-md border border-border">
            <li v-for="tok in PATTERN_TOKENS" :key="tok.token">
              <button
                type="button"
                class="group flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                :aria-label="t('settings.reader.fileNaming.copyValue', { value: tokenLabel(tok.token) })"
                @click="copyToken(tok.token)"
              >
                <span class="min-w-0">
                  <code class="font-mono text-xs font-semibold text-primary">{{ tokenLabel(tok.token) }}</code>
                  <span class="settings-hint block">{{ TOKEN_DESCRIPTIONS[tok.token] }}</span>
                </span>
                <ClipboardCopy :size="14" class="shrink-0 text-muted-foreground transition-colors group-hover:text-primary" aria-hidden="true" />
              </button>
            </li>
          </ul>
        </div>

        <div
          v-else-if="activeTab === 'modifiers'"
          id="pattern-help-panel-modifiers"
          role="tabpanel"
          aria-labelledby="pattern-help-tab-modifiers"
          class="space-y-3"
        >
          <p class="settings-hint mt-0">
            {{ t('settings.reader.fileNaming.modifiersExplain') }}
            <code class="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">{authors:first}</code>
          </p>
          <ul class="divide-y divide-border rounded-md border border-border">
            <li v-for="mod in MODIFIERS" :key="mod.key" class="flex items-center gap-3 px-3 py-2.5">
              <code class="shrink-0 font-mono text-xs font-semibold text-foreground">{{ mod.key }}</code>
              <span class="text-xs text-muted-foreground">{{ mod.description }}</span>
            </li>
          </ul>

          <div class="space-y-2 rounded-md border border-border bg-muted/40 px-3 py-2.5">
            <p class="settings-label">{{ t('settings.reader.fileNaming.conditionalLogic') }}</p>
            <p class="settings-hint">
              {{ t('settings.reader.fileNaming.conditionalPart1') }}
              <code class="rounded bg-muted px-1 py-0.5 font-mono text-foreground">&lt;...&gt;</code>
              {{ t('settings.reader.fileNaming.conditionalPart2') }}
              <code class="rounded bg-muted px-1 py-0.5 font-mono text-foreground">|fallback</code>
              {{ t('settings.reader.fileNaming.conditionalPart3') }}
            </p>
            <p class="settings-hint">
              {{ t('settings.reader.fileNaming.folderOnlyPrefix') }}
              <code class="rounded bg-muted px-1 py-0.5 font-mono text-foreground">/</code>
              {{ t('settings.reader.fileNaming.folderOnlySuffix') }}
            </p>
          </div>
        </div>

        <div
          v-else
          id="pattern-help-panel-examples"
          role="tabpanel"
          aria-labelledby="pattern-help-tab-examples"
          class="divide-y divide-border rounded-md border border-border"
        >
          <div v-for="ex in EXAMPLES" :key="ex.pattern" class="space-y-2 px-3 py-3">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="settings-label">{{ ex.label }}</p>
                <div class="overflow-x-auto">
                  <code class="whitespace-nowrap font-mono text-xs text-muted-foreground">{{ ex.pattern }}</code>
                </div>
              </div>
              <button
                type="button"
                class="settings-btn-outline"
                :aria-label="t('settings.reader.fileNaming.copyExample', { label: ex.label })"
                @click="copyPattern(ex.pattern)"
              >
                <ClipboardCopy :size="12" aria-hidden="true" />
                {{ t('settings.reader.fileNaming.copy') }}
              </button>
            </div>
            <dl class="space-y-1">
              <div v-for="c in ex.cases" :key="c.label" class="flex items-baseline gap-2">
                <dt class="w-20 shrink-0 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{{ c.label }}</dt>
                <dd class="min-w-0 overflow-x-auto">
                  <code class="whitespace-nowrap font-mono text-xs text-primary">{{ c.result }}</code>
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </SheetContent>
  </Sheet>
</template>
