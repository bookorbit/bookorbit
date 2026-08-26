<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Command, X } from '@lucide/vue'
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'

const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()

const ROWS = computed(() => [
  { key: 'move', keys: ['J', 'K'] },
  { key: 'open', keys: ['Enter'] },
  { key: 'back', keys: ['Esc'] },
  { key: 'search', keys: ['/'] },
  { key: 'note', keys: ['N'] },
  { key: 'recolour', keys: ['1', '9'] },
  { key: 'select', keys: ['X'] },
  { key: 'regroup', keys: ['G'] },
  { key: 'copy', keys: ['C'] },
  { key: 'reader', keys: ['O'] },
])
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm" />
      <DialogContent
        class="fixed left-1/2 top-1/2 z-50 w-[32rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
      >
        <header class="flex h-[38px] items-center gap-2 border-b border-border px-3.5">
          <Command :size="13" class="text-muted-foreground" />
          <DialogTitle class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {{ t('book.detail.highlights.shortcuts.title') }}
          </DialogTitle>
          <DialogClose
            class="ml-auto grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            :aria-label="t('common.close')"
          >
            <X :size="13" />
          </DialogClose>
        </header>
        <DialogDescription class="sr-only">{{ t('book.detail.highlights.shortcuts.description') }}</DialogDescription>
        <div class="grid gap-x-5 px-3.5 pb-3.5 pt-2.5 sm:grid-cols-2">
          <div
            v-for="row in ROWS"
            :key="row.key"
            class="grid h-[26px] grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5 border-t border-border/50 first:border-t-0 sm:[&:nth-child(2)]:border-t-0"
          >
            <span class="truncate text-[11.5px] text-muted-foreground">{{ t(`book.detail.highlights.shortcuts.${row.key}`) }}</span>
            <span class="flex gap-1">
              <kbd
                v-for="key in row.keys"
                :key="key"
                class="grid h-[19px] min-w-[19px] place-items-center rounded-md border border-border bg-muted px-1.5 font-mono text-[10px] font-semibold text-foreground"
              >
                {{ key }}
              </kbd>
            </span>
          </div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
