<script setup lang="ts">
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CbxReaderSettings } from '@bookorbit/types'
import { useReaderDefaultSettings } from '@/features/reader/shared/composables/useReaderSettings'
import SettingsPageHeader from './SettingsPageHeader.vue'

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    embedded?: boolean
  }>(),
  {
    embedded: false,
  },
)

const { effective, load, update, reset } = useReaderDefaultSettings<CbxReaderSettings>('cbx')

onMounted(load)
</script>

<template>
  <div
    class="[&_.settings-hint]:overflow-hidden [&_.settings-hint]:text-ellipsis [&_.settings-hint]:whitespace-nowrap md:[&_.settings-hint]:overflow-visible md:[&_.settings-hint]:whitespace-normal"
  >
    <SettingsPageHeader v-if="!props.embedded" :title="t('settings.reader.comics.title')" :subtitle="t('settings.reader.comics.subtitle')">
      <button class="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2" @click="reset()">
        {{ t('settings.reader.resetToDefaults') }}
      </button>
    </SettingsPageHeader>
    <template v-else>
      <div
        class="md:hidden sticky top-11 z-10 -mx-4 mb-4 px-4 py-2 border-y border-border/70 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/75"
      >
        <button class="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2" @click="reset()">
          {{ t('settings.reader.resetToDefaults') }}
        </button>
      </div>
      <div class="hidden md:flex justify-end mb-4">
        <button class="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2" @click="reset()">
          {{ t('settings.reader.resetToDefaults') }}
        </button>
      </div>
    </template>

    <!-- View -->
    <div class="mb-6">
      <p class="settings-group-label">{{ t('settings.reader.comics.view') }}</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
        <!-- Scroll mode -->
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div>
            <p class="settings-label">{{ t('settings.reader.comics.readingMode') }}</p>
            <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:overflow-visible md:whitespace-normal">
              {{ t('settings.reader.comics.readingModeHint') }}
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-1.5 p-1 rounded-lg border border-border bg-muted/50 self-start">
            <button
              class="h-8 px-3 rounded-md text-xs font-medium transition-colors"
              :class="
                effective.scrollMode === 'paginated' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'
              "
              @click="update({ scrollMode: 'paginated' })"
            >
              {{ t('settings.reader.comics.paginated') }}
            </button>
            <button
              class="h-8 px-3 rounded-md text-xs font-medium transition-colors"
              :class="effective.scrollMode === 'infinite' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="update({ scrollMode: 'infinite' })"
            >
              {{ t('settings.reader.comics.infiniteSpaced') }}
            </button>
            <button
              class="h-8 px-3 rounded-md text-xs font-medium transition-colors"
              :class="
                effective.scrollMode === 'long-strip' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'
              "
              @click="update({ scrollMode: 'long-strip' })"
            >
              {{ t('settings.reader.comics.infiniteNoGaps') }}
            </button>
          </div>
        </div>

        <!-- View mode -->
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div>
            <p class="settings-label">{{ t('settings.reader.comics.pageView') }}</p>
            <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:overflow-visible md:whitespace-normal">
              {{ t('settings.reader.comics.pageViewHint') }}
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-1.5 p-1 rounded-lg border border-border bg-muted/50 self-start">
            <button
              class="h-8 px-3 rounded-md text-xs font-medium transition-colors"
              :class="effective.viewMode === 'single' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="update({ viewMode: 'single' })"
            >
              {{ t('settings.reader.comics.single') }}
            </button>
            <button
              class="h-8 px-3 rounded-md text-xs font-medium transition-colors"
              :class="effective.viewMode === 'two-page' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="update({ viewMode: 'two-page' })"
            >
              {{ t('settings.reader.comics.twoPage') }}
            </button>
          </div>
        </div>

        <!-- Fit mode -->
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div>
            <p class="settings-label">{{ t('settings.reader.comics.fitMode') }}</p>
            <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:overflow-visible md:whitespace-normal">
              {{ t('settings.reader.comics.fitModeHint') }}
            </p>
          </div>
          <div class="flex flex-wrap gap-2 self-start md:self-auto md:justify-end">
            <button
              v-for="opt in [
                { id: 'fit-page' as const, label: t('settings.reader.comics.fitPage') },
                { id: 'fit-width' as const, label: t('settings.reader.comics.fitWidth') },
                { id: 'fit-height' as const, label: t('settings.reader.comics.fitHeight') },
                { id: 'actual' as const, label: t('settings.reader.comics.fitActual') },
              ]"
              :key="opt.id"
              class="h-8 md:h-7 px-3 text-xs border-2 transition-colors font-medium rounded-md"
              :class="
                effective.fitMode === opt.id
                  ? 'border-primary text-primary bg-primary/8'
                  : 'border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground'
              "
              @click="update({ fitMode: opt.id })"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>

        <!-- Reading direction -->
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div>
            <p class="settings-label">{{ t('settings.reader.comics.readingDirection') }}</p>
            <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:overflow-visible md:whitespace-normal">
              {{ t('settings.reader.comics.readingDirectionHint') }}
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-1.5 p-1 rounded-lg border border-border bg-muted/50 self-start">
            <button
              class="h-8 px-3 rounded-md text-xs font-medium transition-colors"
              :class="effective.direction === 'ltr' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="update({ direction: 'ltr' })"
            >
              {{ t('settings.reader.comics.ltr') }}
            </button>
            <button
              class="h-8 px-3 rounded-md text-xs font-medium transition-colors"
              :class="effective.direction === 'rtl' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="update({ direction: 'rtl' })"
            >
              {{ t('settings.reader.comics.rtl') }}
            </button>
          </div>
        </div>

        <!-- Spread alignment -->
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div>
            <p class="settings-label">{{ t('settings.reader.comics.spreadAlignment') }}</p>
            <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:overflow-visible md:whitespace-normal">
              {{ t('settings.reader.comics.spreadAlignmentHint') }}
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-1.5 p-1 rounded-lg border border-border bg-muted/50 self-start">
            <button
              class="h-8 px-3 rounded-md text-xs font-medium transition-colors"
              :class="
                effective.spreadAlignment === 'normal' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'
              "
              @click="update({ spreadAlignment: 'normal' })"
            >
              {{ t('settings.reader.comics.alignmentNormal') }}
            </button>
            <button
              class="h-8 px-3 rounded-md text-xs font-medium transition-colors"
              :class="
                effective.spreadAlignment === 'shifted' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'
              "
              @click="update({ spreadAlignment: 'shifted' })"
            >
              {{ t('settings.reader.comics.alignmentShifted') }}
            </button>
          </div>
        </div>

        <!-- Wide page handling -->
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div>
            <p class="settings-label">{{ t('settings.reader.comics.widePageHandling') }}</p>
            <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:overflow-visible md:whitespace-normal">
              {{ t('settings.reader.comics.widePageHandlingHint') }}
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-1.5 p-1 rounded-lg border border-border bg-muted/50 self-start">
            <button
              class="h-8 px-3 rounded-md text-xs font-medium transition-colors"
              :class="
                effective.widePageSingletonMode === 'auto' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'
              "
              @click="update({ widePageSingletonMode: 'auto' })"
            >
              {{ t('settings.reader.comics.widePageAuto') }}
            </button>
            <button
              class="h-8 px-3 rounded-md text-xs font-medium transition-colors"
              :class="
                effective.widePageSingletonMode === 'disable'
                  ? 'bg-background shadow-xs text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              "
              @click="update({ widePageSingletonMode: 'disable' })"
            >
              {{ t('settings.reader.comics.widePageDisable') }}
            </button>
          </div>
        </div>

        <!-- Force two-page -->
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div>
            <p class="settings-label">{{ t('settings.reader.comics.forceTwoPage') }}</p>
            <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:overflow-visible md:whitespace-normal">
              {{ t('settings.reader.comics.forceTwoPageHint') }}
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-1.5 p-1 rounded-lg border border-border bg-muted/50 self-start">
            <button
              class="h-8 px-3 rounded-md text-xs font-medium transition-colors"
              :class="!effective.forceTwoPage ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="update({ forceTwoPage: false })"
            >
              {{ t('settings.reader.comics.off') }}
            </button>
            <button
              class="h-8 px-3 rounded-md text-xs font-medium transition-colors"
              :class="effective.forceTwoPage ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'"
              @click="update({ forceTwoPage: true })"
            >
              {{ t('settings.reader.comics.on') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Display -->
    <div class="mb-6">
      <p class="settings-group-label">{{ t('settings.reader.comics.display') }}</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
        <!-- Background color -->
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div>
            <p class="settings-label">{{ t('settings.reader.comics.backgroundColor') }}</p>
            <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:overflow-visible md:whitespace-normal">
              {{ t('settings.reader.comics.backgroundColorHint') }}
            </p>
          </div>
          <div class="flex flex-wrap gap-2 self-start">
            <button
              v-for="opt in [
                { id: 'black' as const, label: t('settings.reader.comics.bgBlack') },
                { id: 'gray' as const, label: t('settings.reader.comics.bgGray') },
                { id: 'white' as const, label: t('settings.reader.comics.bgWhite') },
              ]"
              :key="opt.id"
              class="h-8 md:h-7 px-3 text-xs border-2 transition-colors font-medium rounded-md"
              :class="
                effective.bgColor === opt.id
                  ? 'border-primary text-primary bg-primary/8'
                  : 'border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground'
              "
              @click="update({ bgColor: opt.id })"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
