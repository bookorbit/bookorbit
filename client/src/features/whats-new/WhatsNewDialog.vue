<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowRight, ChevronDown, ExternalLink, Sparkles, X } from '@lucide/vue'
import { useModal } from '@/composables/useModal'
import { useWhatsNew } from './composables/useWhatsNew'
import { formatReleaseDate } from './lib/whats-new.logic'
import { anyLightboxOpen } from './lib/lightbox-state'
import HighlightItem from './components/HighlightItem.vue'

const { t } = useI18n()
const { version, releases, hasMore, acknowledge, remindLater } = useWhatsNew()

const expanded = ref(new Set<string>(releases.value[0] ? [releases.value[0].version] : []))
const panel = ref<HTMLElement | null>(null)
const ackButton = ref<HTMLButtonElement | null>(null)

function isExpanded(version: string): boolean {
  return expanded.value.has(version)
}

function toggle(version: string): void {
  const next = new Set(expanded.value)
  if (next.has(version)) next.delete(version)
  else next.add(version)
  expanded.value = next
}

function handleAck(): void {
  void acknowledge()
}

function handleLater(): void {
  remindLater()
}

useModal({
  container: panel,
  onClose: remindLater,
  disabled: () => anyLightboxOpen.value,
  initialFocus: ackButton,
})
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-[75] flex items-end justify-center bg-black/50 motion-safe:animate-in motion-safe:fade-in sm:items-center sm:px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="whats-new-title"
      @click.self="handleLater"
    >
      <div
        ref="panel"
        class="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-t-2xl border border-border bg-card shadow-xl motion-safe:animate-in motion-safe:slide-in-from-bottom-4 sm:rounded-2xl"
      >
        <header class="relative shrink-0 overflow-hidden border-b border-border px-5 pb-4 pt-5">
          <div
            class="pointer-events-none absolute inset-0"
            style="
              background-image: radial-gradient(ellipse 90% 70% at 0% -20%, color-mix(in oklch, var(--primary) 14%, transparent) 0%, transparent 70%);
            "
          />
          <div class="relative flex items-start justify-between gap-3">
            <div class="flex items-center gap-3">
              <span class="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-primary">
                <Sparkles :size="22" />
              </span>
              <div>
                <h2 id="whats-new-title" class="text-lg font-semibold tracking-tight text-foreground">{{ t('whatsNew.title') }}</h2>
                <p class="text-sm text-muted-foreground">
                  <template v-if="version">{{ t('whatsNew.versionPrefix', { version }) }} · </template
                  >{{ t('whatsNew.newUpdates', { count: releases.length }, releases.length) }}
                </p>
              </div>
            </div>
            <button
              type="button"
              class="-mr-1 -mt-1 shrink-0 text-muted-foreground transition-colors hover:text-foreground"
              :aria-label="t('whatsNew.remindLater')"
              @click="handleLater"
            >
              <X :size="18" />
            </button>
          </div>
        </header>

        <div class="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <section v-for="(release, index) in releases" :key="release.version" class="rounded-lg border border-border bg-background p-4">
            <button type="button" class="flex w-full items-center justify-between gap-3 text-left" @click="toggle(release.version)">
              <div class="flex flex-wrap items-center gap-2">
                <span class="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{{ release.version }}</span>
                <span
                  v-if="index === 0"
                  class="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground"
                >
                  {{ t('whatsNew.latest') }}
                </span>
                <span v-if="formatReleaseDate(release.date)" class="text-xs text-muted-foreground">{{ formatReleaseDate(release.date) }}</span>
              </div>
              <ChevronDown
                :size="16"
                class="shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none"
                :class="isExpanded(release.version) ? 'rotate-180' : ''"
              />
            </button>

            <template v-if="isExpanded(release.version) && release.highlights.length">
              <ul class="mt-3 divide-y divide-border/60">
                <li v-for="(highlight, hIndex) in release.highlights" :key="hIndex" class="py-4 first:pt-0 last:pb-0">
                  <HighlightItem :highlight="highlight" :show-media="index === 0" compact />
                </li>
              </ul>
            </template>

            <a
              v-if="isExpanded(release.version)"
              :href="release.changelogUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:text-primary/85"
            >
              {{ t('whatsNew.fullChangelog') }}
              <ExternalLink :size="12" />
            </a>
          </section>

          <RouterLink
            v-if="hasMore"
            to="/whats-new"
            class="inline-flex items-center gap-1 text-sm font-medium text-primary transition-colors hover:text-primary/85"
            @click="handleLater"
          >
            {{ t('whatsNew.seeAllReleases') }}
            <ArrowRight :size="14" />
          </RouterLink>
        </div>

        <footer class="flex shrink-0 items-center justify-end gap-3 border-t border-border px-5 py-4">
          <button
            type="button"
            class="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            @click="handleLater"
          >
            {{ t('whatsNew.remindLater') }}
          </button>
          <button
            ref="ackButton"
            type="button"
            class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            @click="handleAck"
          >
            {{ t('whatsNew.gotIt') }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
