<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { LibraryScanHistoryEntry } from '@bookorbit/types'
import { formatDateTime } from '@/i18n/formatters'
import { relativeTimestamp } from '@/lib/relative-time'

defineProps<{ entries: LibraryScanHistoryEntry[] }>()

const { t } = useI18n()

function durationLabel(entry: LibraryScanHistoryEntry): string {
  if (!entry.completedAt) return '—'
  const ms = new Date(entry.completedAt).getTime() - new Date(entry.startedAt).getTime()
  if (!Number.isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return t('settings.admin.libraries.durationMs', { ms })
  if (ms < 60_000) return t('settings.admin.libraries.durationSeconds', { seconds: (ms / 1000).toFixed(1) })
  return t('settings.admin.libraries.durationMinutes', { minutes: Math.floor(ms / 60_000), seconds: Math.round((ms % 60_000) / 1000) })
}

function resultParts(entry: LibraryScanHistoryEntry): { added: number; updated: number; missing: number; empty: boolean } {
  const { addedCount, updatedCount, missingCount } = entry
  return { added: addedCount, updated: updatedCount, missing: missingCount, empty: addedCount === 0 && updatedCount === 0 && missingCount === 0 }
}
</script>

<template>
  <table class="w-full border-collapse text-xs">
    <thead>
      <tr>
        <th scope="col" class="w-36 pb-1.5 pe-3 text-start text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {{ t('settings.admin.libraries.history.when') }}
        </th>
        <th scope="col" class="w-24 pb-1.5 pe-3 text-start text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {{ t('settings.admin.libraries.history.trigger') }}
        </th>
        <th scope="col" class="w-24 pb-1.5 pe-3 text-start text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {{ t('settings.admin.libraries.history.duration') }}
        </th>
        <th scope="col" class="pb-1.5 pe-3 text-start text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {{ t('settings.admin.libraries.history.result') }}
        </th>
        <th scope="col" class="w-28 pb-1.5 text-end text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {{ t('settings.admin.libraries.history.status') }}
        </th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="entry in entries" :key="entry.id" class="border-t border-border">
        <td class="py-1.5 pe-3 whitespace-nowrap text-foreground" :title="formatDateTime(new Date(entry.startedAt))">
          {{ relativeTimestamp(entry.startedAt) }}
        </td>
        <td class="py-1.5 pe-3 whitespace-nowrap font-mono text-[11px] text-muted-foreground">
          {{ t(`settings.admin.libraries.trigger.${entry.triggeredBy}`) }}
        </td>
        <td class="py-1.5 pe-3 whitespace-nowrap font-mono text-[11px] tabular-nums text-muted-foreground">{{ durationLabel(entry) }}</td>
        <td class="py-1.5 pe-3">
          <span v-if="entry.errorMessage" class="block truncate text-destructive" :title="entry.errorMessage">{{ entry.errorMessage }}</span>
          <template v-else-if="resultParts(entry).empty">
            <span class="text-muted-foreground">{{ t('settings.admin.libraries.scanNoChange') }}</span>
          </template>
          <template v-else>
            <span v-if="entry.addedCount > 0" class="me-2 whitespace-nowrap text-[var(--pill-success)]">
              {{ t('settings.admin.libraries.scanAdded', { count: entry.addedCount }) }}
            </span>
            <span v-if="entry.updatedCount > 0" class="me-2 whitespace-nowrap text-muted-foreground">
              {{ t('settings.admin.libraries.scanUpdated', { count: entry.updatedCount }) }}
            </span>
            <span v-if="entry.missingCount > 0" class="whitespace-nowrap text-[var(--pill-warning)]">
              {{ t('settings.admin.libraries.scanMissing', { count: entry.missingCount }) }}
            </span>
          </template>
        </td>
        <td class="py-1.5 text-end">
          <span
            class="inline-flex items-center rounded-full border px-2 py-0.5 text-[10.5px] font-semibold"
            :class="
              entry.status === 'failed'
                ? 'border-destructive/35 bg-destructive/12 text-destructive'
                : entry.status === 'running'
                  ? 'border-primary/40 bg-primary/15 text-primary'
                  : 'border-[var(--pill-success)]/35 bg-[var(--pill-success)]/12 text-[var(--pill-success)]'
            "
          >
            {{ t(`settings.admin.libraries.history.statusValue.${entry.status}`) }}
          </span>
        </td>
      </tr>
    </tbody>
  </table>
</template>
