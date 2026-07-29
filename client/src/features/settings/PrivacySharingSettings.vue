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
const historyPages = computed(() => Math.max(1, Math.ceil(sharing.history.value.total / sharing.history.value.pageSize)))

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
  if (minutes < 60) return t('settings.privacySharing.durationMinutes', { count: minutes })
  const hours = Math.round((minutes / 60) * 10) / 10
  return t('settings.privacySharing.durationHours', { count: hours })
}
</script>

<template>
  <section aria-labelledby="privacy-sharing-heading" class="space-y-6">
    <div
      v-if="sharing.error.value && !sharing.loaded.value"
      role="alert"
      class="space-y-3 rounded-lg border border-destructive/30 bg-card p-4 shadow-xs md:p-5"
    >
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

      <div class="space-y-3">
        <div>
          <h2 id="privacy-sharing-heading" class="settings-group-label mb-0">{{ t('settings.privacySharing.title') }}</h2>
          <p class="settings-hint">{{ t('settings.privacySharing.subtitle') }}</p>
        </div>
        <fieldset>
          <legend class="sr-only">{{ t('settings.privacySharing.levelLegend') }}</legend>
          <div class="grid gap-3 lg:grid-cols-3">
            <label
              v-for="option in options"
              :key="option.level"
              class="relative cursor-pointer rounded-lg border bg-card p-4 shadow-xs transition-colors focus-within:ring-2 focus-within:ring-ring md:p-5"
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
              <component :is="option.icon" :size="18" class="text-muted-foreground" aria-hidden="true" />
              <span class="settings-label mt-3 block">{{ t(`settings.privacySharing.levels.${option.level}.title`) }}</span>
              <span class="settings-hint block">{{ t(`settings.privacySharing.levels.${option.level}.description`) }}</span>
              <span
                v-if="sharing.settings.value.sharingLevel === option.level"
                class="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary"
              >
                <ShieldCheck :size="13" aria-hidden="true" />
                {{ t('settings.privacySharing.current') }}
              </span>
            </label>
          </div>
        </fieldset>
      </div>

      <section
        v-if="sharing.settings.value.sharingLevel !== 'private'"
        aria-labelledby="privacy-preview-heading"
        class="rounded-lg border border-border bg-card p-4 shadow-xs md:p-5"
      >
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div class="min-w-0">
            <h3 id="privacy-preview-heading" class="text-sm font-semibold text-foreground">{{ t('settings.privacySharing.preview.title') }}</h3>
            <p class="settings-hint">{{ t('settings.privacySharing.preview.description') }}</p>
          </div>
          <button type="button" class="settings-btn-outline shrink-0 justify-center" :disabled="sharing.previewLoading.value" @click="handlePreview">
            {{ sharing.previewLoading.value ? t('common.loading') : t('settings.privacySharing.preview.action') }}
          </button>
        </div>
        <dl v-if="sharing.previewSummary.value" class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div class="rounded-md border border-border/60 bg-muted/40 p-3">
            <dt class="text-xs text-muted-foreground">{{ t('settings.privacySharing.preview.readingTime') }}</dt>
            <dd class="settings-value mt-1">{{ durationLabel(sharing.previewSummary.value.readingSeconds) }}</dd>
          </div>
          <div class="rounded-md border border-border/60 bg-muted/40 p-3">
            <dt class="text-xs text-muted-foreground">{{ t('settings.privacySharing.preview.activeDays') }}</dt>
            <dd class="settings-value mt-1">{{ formatNumber(sharing.previewSummary.value.activeDays) }}</dd>
          </div>
          <div class="rounded-md border border-border/60 bg-muted/40 p-3">
            <dt class="text-xs text-muted-foreground">{{ t('settings.privacySharing.preview.started') }}</dt>
            <dd class="settings-value mt-1">{{ formatNumber(sharing.previewSummary.value.booksStarted) }}</dd>
          </div>
          <div class="rounded-md border border-border/60 bg-muted/40 p-3">
            <dt class="text-xs text-muted-foreground">{{ t('settings.privacySharing.preview.completed') }}</dt>
            <dd class="settings-value mt-1">{{ formatNumber(sharing.previewSummary.value.booksCompleted) }}</dd>
          </div>
        </dl>
        <div v-if="sharing.previewDetail.value" class="mt-4">
          <p class="settings-label">{{ t('settings.privacySharing.preview.topBooks') }}</p>
          <ul class="mt-2 space-y-1 text-xs text-muted-foreground">
            <li v-for="book in sharing.previewDetail.value.topBooks" :key="book.bookId">
              {{ book.title ?? t('settings.privacySharing.unknownTitle') }}
            </li>
          </ul>
        </div>
      </section>

      <section aria-labelledby="privacy-history-heading" class="rounded-lg border border-border bg-card p-4 shadow-xs md:p-5">
        <h3 id="privacy-history-heading" class="text-sm font-semibold text-foreground">{{ t('settings.privacySharing.history.title') }}</h3>
        <p class="settings-hint">{{ t('settings.privacySharing.history.description') }}</p>
        <p v-if="sharing.history.value.items.length === 0" class="mt-4 text-sm text-muted-foreground">
          {{ t('settings.privacySharing.history.empty') }}
        </p>
        <ul v-else class="mt-4 divide-y divide-border">
          <li v-for="item in sharing.history.value.items" :key="item.id" class="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <div class="min-w-0">
              <p class="settings-label truncate">{{ item.viewerUsername }}</p>
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
      </section>
    </template>

    <Sheet :open="confirmationOpen" @update:open="handleConfirmationOpen">
      <SheetContent side="right" class="w-full gap-0 sm:max-w-md">
        <SheetHeader class="border-b border-border pr-10">
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

        <div class="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <ul v-if="pendingLevel !== 'private'" class="space-y-2">
            <li v-for="field in confirmationFields" :key="field" class="flex items-start gap-2 text-sm text-foreground">
              <ListChecks :size="16" class="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
              {{ t(`settings.privacySharing.fields.${field}`) }}
            </li>
          </ul>
          <p class="settings-hint">{{ t('settings.privacySharing.confirm.recordedNotice') }}</p>
        </div>

        <SheetFooter class="flex-row justify-end border-t border-border">
          <button type="button" class="settings-btn-outline justify-center" @click="cancelChange">{{ t('common.cancel') }}</button>
          <button type="button" class="settings-btn-primary justify-center" :disabled="sharing.saving.value" @click="confirmChange">
            {{ sharing.saving.value ? t('common.loading') : t('common.confirm') }}
          </button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  </section>
</template>
