<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Eye, EyeOff, ListChecks, ShieldCheck } from '@lucide/vue'
import type { ReadingInsightsSharingLevel } from '@bookorbit/types'

import { formatDateTime, formatNumber } from '@/i18n/formatters'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useReadingInsightsSharing } from './composables/useReadingInsightsSharing'

const { t } = useI18n()
const sharing = useReadingInsightsSharing()
const confirmationOpen = ref(false)
const pendingLevel = ref<ReadingInsightsSharingLevel>('private')

const options = computed(() => [
  { level: 'private' as const, icon: EyeOff },
  { level: 'summary' as const, icon: ListChecks },
  { level: 'detailed' as const, icon: Eye },
])

const confirmationFields = computed(() => {
  if (pendingLevel.value === 'private') return []
  const summary = ['frequency', 'completion', 'formats', 'genres', 'trend']
  return pendingLevel.value === 'summary' ? summary : [...summary, 'books', 'authors', 'series', 'narrators']
})
const historyPages = computed(() => Math.ceil(sharing.history.value.total / sharing.history.value.pageSize))

onMounted(sharing.load)

function selectLevel(level: ReadingInsightsSharingLevel) {
  if (level === sharing.settings.value.sharingLevel) return
  pendingLevel.value = level
  confirmationOpen.value = true
}

function handleConfirmationOpen(open: boolean) {
  confirmationOpen.value = open
  if (!open) pendingLevel.value = sharing.settings.value.sharingLevel
}

function cancelChange() {
  pendingLevel.value = sharing.settings.value.sharingLevel
  confirmationOpen.value = false
}

async function confirmChange() {
  const saved = await sharing.update(pendingLevel.value)
  if (saved) confirmationOpen.value = false
}

function handlePreview() {
  void sharing.loadPreview()
}

function handleRetry() {
  void sharing.load()
}

function handlePreviousHistoryPage() {
  if (sharing.history.value.page <= 1) return
  void sharing.loadHistory(sharing.history.value.page - 1)
}

function handleNextHistoryPage() {
  if (sharing.history.value.page >= historyPages.value) return
  void sharing.loadHistory(sharing.history.value.page + 1)
}

function durationLabel(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return t('settings.privacySharing.durationMinutes', { count: minutes }, minutes)
  const hours = Math.round((minutes / 60) * 10) / 10
  return t('settings.privacySharing.durationHours', { count: formatNumber(hours) })
}
</script>

<template>
  <section aria-labelledby="privacy-sharing-title" class="space-y-6">
    <div>
      <h2 id="privacy-sharing-title" class="text-lg font-semibold text-foreground">{{ t('settings.privacySharing.title') }}</h2>
      <p class="mt-1 text-sm text-muted-foreground">{{ t('settings.privacySharing.subtitle') }}</p>
    </div>

    <div v-if="sharing.error.value && !sharing.loaded.value" role="alert" class="space-y-3 rounded-lg border border-destructive/30 p-4">
      <p class="text-sm text-destructive">
        {{ t(`settings.privacySharing.errors.${sharing.error.value}`) }}
      </p>
      <button type="button" class="settings-btn-outline" @click="handleRetry">{{ t('common.retry') }}</button>
    </div>
    <p v-else-if="sharing.loading.value" role="status" class="text-sm text-muted-foreground">{{ t('common.loading') }}</p>

    <template v-else-if="sharing.loaded.value">
      <p v-if="sharing.error.value" role="alert" class="text-sm text-destructive">
        {{ t(`settings.privacySharing.errors.${sharing.error.value}`) }}
      </p>
      <fieldset class="grid gap-3 lg:grid-cols-3">
        <legend class="sr-only">{{ t('settings.privacySharing.levelLegend') }}</legend>
        <label
          v-for="option in options"
          :key="option.level"
          class="relative cursor-pointer rounded-lg border bg-card p-4 shadow-xs transition-colors focus-within:ring-2 focus-within:ring-ring"
          :class="sharing.settings.value.sharingLevel === option.level ? 'border-primary' : 'border-border hover:bg-muted/30'"
        >
          <input
            type="radio"
            name="reading-insights-sharing"
            :value="option.level"
            :checked="sharing.settings.value.sharingLevel === option.level"
            class="sr-only"
            @change="selectLevel(option.level)"
          />
          <component :is="option.icon" :size="20" class="text-muted-foreground" aria-hidden="true" />
          <span class="mt-3 block font-medium text-foreground">{{ t(`settings.privacySharing.levels.${option.level}.title`) }}</span>
          <span class="mt-1 block text-sm leading-5 text-muted-foreground">{{
            t(`settings.privacySharing.levels.${option.level}.description`)
          }}</span>
          <span
            v-if="sharing.settings.value.sharingLevel === option.level"
            class="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary"
          >
            <ShieldCheck :size="13" aria-hidden="true" />
            {{ t('settings.privacySharing.current') }}
          </span>
        </label>
      </fieldset>

      <div v-if="sharing.settings.value.sharingLevel !== 'private'" class="rounded-lg border border-border bg-card p-4">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p class="font-medium text-foreground">{{ t('settings.privacySharing.preview.title') }}</p>
            <p class="mt-1 text-sm text-muted-foreground">{{ t('settings.privacySharing.preview.description') }}</p>
          </div>
          <button type="button" class="settings-btn-outline shrink-0 justify-center" :disabled="sharing.previewLoading.value" @click="handlePreview">
            {{ sharing.previewLoading.value ? t('common.loading') : t('settings.privacySharing.preview.action') }}
          </button>
        </div>
        <div v-if="sharing.previewSummary.value" class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div class="rounded-md bg-muted/50 p-3">
            <p class="text-xs text-muted-foreground">{{ t('settings.privacySharing.preview.readingTime') }}</p>
            <p class="mt-1 font-semibold text-foreground">{{ durationLabel(sharing.previewSummary.value.readingSeconds) }}</p>
          </div>
          <div class="rounded-md bg-muted/50 p-3">
            <p class="text-xs text-muted-foreground">{{ t('settings.privacySharing.preview.activeDays') }}</p>
            <p class="mt-1 font-semibold text-foreground">{{ formatNumber(sharing.previewSummary.value.activeDays) }}</p>
          </div>
          <div class="rounded-md bg-muted/50 p-3">
            <p class="text-xs text-muted-foreground">{{ t('settings.privacySharing.preview.started') }}</p>
            <p class="mt-1 font-semibold text-foreground">{{ formatNumber(sharing.previewSummary.value.booksStarted) }}</p>
          </div>
          <div class="rounded-md bg-muted/50 p-3">
            <p class="text-xs text-muted-foreground">{{ t('settings.privacySharing.preview.completed') }}</p>
            <p class="mt-1 font-semibold text-foreground">{{ formatNumber(sharing.previewSummary.value.booksCompleted) }}</p>
          </div>
        </div>
        <div v-if="sharing.previewDetail.value" class="mt-4">
          <p class="text-sm font-medium text-foreground">{{ t('settings.privacySharing.preview.topBooks') }}</p>
          <ul class="mt-2 space-y-1 text-sm text-muted-foreground">
            <li v-for="book in sharing.previewDetail.value.topBooks" :key="book.bookId">
              {{ book.title ?? t('settings.privacySharing.unknownTitle') }}
            </li>
          </ul>
        </div>
      </div>

      <div class="rounded-lg border border-border bg-card p-4">
        <h3 class="font-medium text-foreground">{{ t('settings.privacySharing.history.title') }}</h3>
        <p class="mt-1 text-sm text-muted-foreground">{{ t('settings.privacySharing.history.description') }}</p>
        <p v-if="sharing.history.value.items.length === 0" class="mt-4 text-sm text-muted-foreground">
          {{ t('settings.privacySharing.history.empty') }}
        </p>
        <ul v-else class="mt-4 divide-y divide-border">
          <li v-for="item in sharing.history.value.items" :key="item.id" class="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <div class="min-w-0">
              <p class="truncate text-sm font-medium text-foreground">{{ item.viewerUsername }}</p>
              <p class="text-xs text-muted-foreground">{{ t(`settings.privacySharing.levels.${item.sharingLevel}.title`) }}</p>
            </div>
            <time :datetime="item.viewedAt" class="shrink-0 text-xs text-muted-foreground">{{ formatDateTime(new Date(item.viewedAt)) }}</time>
          </li>
        </ul>
        <nav
          v-if="historyPages > 1"
          :aria-label="t('settings.privacySharing.history.paginationLabel')"
          class="mt-4 flex items-center justify-end gap-2 border-t border-border pt-4"
        >
          <button
            type="button"
            class="settings-btn-outline"
            :disabled="sharing.historyLoading.value || sharing.history.value.page <= 1"
            @click="handlePreviousHistoryPage"
          >
            {{ t('common.previous') }}
          </button>
          <button
            type="button"
            class="settings-btn-outline"
            :disabled="sharing.historyLoading.value || sharing.history.value.page >= historyPages"
            @click="handleNextHistoryPage"
          >
            {{ t('common.next') }}
          </button>
        </nav>
      </div>
    </template>

    <Sheet :open="confirmationOpen" @update:open="handleConfirmationOpen">
      <SheetContent side="right" class="w-[90vw] sm:max-w-md">
        <SheetHeader>
          <SheetTitle>
            {{
              pendingLevel === 'private'
                ? t('settings.privacySharing.confirm.stopTitle')
                : t('settings.privacySharing.confirm.shareTitle', { level: t(`settings.privacySharing.levels.${pendingLevel}.title`) })
            }}
          </SheetTitle>
          <SheetDescription>
            {{
              pendingLevel === 'private'
                ? t('settings.privacySharing.confirm.stopDescription')
                : t('settings.privacySharing.confirm.shareDescription')
            }}
          </SheetDescription>
        </SheetHeader>
        <ul v-if="pendingLevel !== 'private'" class="mt-6 space-y-2 text-sm text-foreground">
          <li v-for="field in confirmationFields" :key="field" class="flex items-start gap-2">
            <ListChecks :size="16" class="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
            {{ t(`settings.privacySharing.fields.${field}`) }}
          </li>
        </ul>
        <p class="mt-6 text-sm text-muted-foreground">{{ t('settings.privacySharing.confirm.recordedNotice') }}</p>
        <SheetFooter class="mt-6 gap-2 sm:gap-2">
          <button type="button" class="settings-btn-outline justify-center" @click="cancelChange">{{ t('common.cancel') }}</button>
          <button type="button" class="settings-btn-primary justify-center" :disabled="sharing.saving.value" @click="confirmChange">
            {{ sharing.saving.value ? t('common.loading') : t('common.confirm') }}
          </button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  </section>
</template>
