<script setup lang="ts">
import { ExternalLink, X } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { useLegalNotices } from './useLegalNotices'

const { t } = useI18n()
const { open, closeLegalNotices, handleOpenChange } = useLegalNotices()

const PROJECT_URL = 'https://github.com/bookorbit/bookorbit'
const LICENSE_URL = `${PROJECT_URL}/blob/main/LICENSE`
const ADDITIONAL_TERMS_URL = `${PROJECT_URL}/blob/main/ADDITIONAL_TERMS.md`
</script>

<template>
  <DialogRoot :open="open" @update:open="handleOpenChange">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-foreground/50" />
      <DialogContent
        aria-modal="true"
        class="fixed left-1/2 top-1/2 z-50 max-h-[calc(100svh-2rem)] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div class="flex items-start justify-between gap-4">
          <div>
            <DialogTitle class="text-lg font-semibold text-foreground">
              {{ t('components.legalNotices.title') }}
            </DialogTitle>
            <DialogDescription class="mt-1 text-sm text-muted-foreground">
              {{ t('components.legalNotices.description') }}
            </DialogDescription>
          </div>
          <button
            type="button"
            class="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-foreground outline-hidden hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            :aria-label="t('common.close')"
            @click="closeLegalNotices"
          >
            <X :size="16" aria-hidden="true" />
          </button>
        </div>

        <div class="mt-6 space-y-4 text-sm">
          <a
            :href="PROJECT_URL"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1.5 font-semibold text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {{ t('components.legalNotices.poweredBy') }}
            <ExternalLink :size="14" aria-hidden="true" />
          </a>

          <div class="space-y-1 text-foreground">
            <p>{{ t('components.legalNotices.originalDevelopment') }}</p>
            <p>{{ t('components.legalNotices.copyright') }}</p>
            <p>{{ t('components.legalNotices.contributors') }}</p>
          </div>

          <p class="text-foreground">{{ t('components.legalNotices.licenseSummary') }}</p>

          <div class="grid gap-2 sm:grid-cols-3">
            <a
              :href="PROJECT_URL"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-2 font-medium text-foreground outline-hidden hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              {{ t('components.legalNotices.sourceCode') }}
              <ExternalLink :size="14" aria-hidden="true" />
            </a>
            <a
              :href="LICENSE_URL"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-2 font-medium text-foreground outline-hidden hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              {{ t('components.legalNotices.license') }}
              <ExternalLink :size="14" aria-hidden="true" />
            </a>
            <a
              :href="ADDITIONAL_TERMS_URL"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-2 font-medium text-foreground outline-hidden hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              {{ t('components.legalNotices.additionalTerms') }}
              <ExternalLink :size="14" aria-hidden="true" />
            </a>
          </div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
