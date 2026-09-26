<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { PODCAST_SHORTCUTS, usePodcastShortcuts } from '../composables/usePodcastShortcuts'

const { t } = useI18n()
const { open, closeShortcuts } = usePodcastShortcuts()
const shortcuts = computed(() =>
  PODCAST_SHORTCUTS.map((shortcut) => ({
    ...shortcut,
    label: t(`podcast.shortcuts.${shortcut.id}`),
    keys: shortcut.keys.map((key) => (key === 'Space' ? t('podcast.shortcuts.spaceKey') : key)),
  })),
)
const shortcutGroups = computed(() =>
  (['playback', 'navigation', 'tools'] as const).map((id) => ({
    id,
    label: t(`podcast.shortcuts.groups.${id}`),
    shortcuts: shortcuts.value.filter((shortcut) => shortcut.group === id),
  })),
)

function handleOpenChange(next: boolean) {
  if (!next) closeShortcuts()
}
</script>

<template>
  <Sheet :open="open" @update:open="handleOpenChange">
    <SheetContent side="right" class="w-full sm:max-w-md" data-testid="podcast-shortcuts-dialog">
      <SheetHeader>
        <SheetTitle>{{ t('podcast.shortcuts.title') }}</SheetTitle>
        <SheetDescription>{{ t('podcast.shortcuts.description') }}</SheetDescription>
      </SheetHeader>
      <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <section v-for="group in shortcutGroups" :key="group.id" class="pt-4 first:pt-2">
          <h3 class="pb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{{ group.label }}</h3>
          <dl class="divide-y divide-border">
            <div v-for="shortcut in group.shortcuts" :key="shortcut.id" class="flex items-center justify-between gap-4 py-2.5">
              <dt class="min-w-0 text-sm text-foreground">{{ shortcut.label }}</dt>
              <dd class="flex shrink-0 items-center gap-1">
                <kbd
                  v-for="key in shortcut.keys"
                  :key="key"
                  class="inline-flex h-6 min-w-6 items-center justify-center rounded border border-border bg-muted px-1.5 font-mono text-[11px] font-medium text-foreground"
                >
                  {{ key }}
                </kbd>
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </SheetContent>
  </Sheet>
</template>
