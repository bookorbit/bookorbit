<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatNumber } from '@/i18n/formatters'
import { getAuditCategory, getAuditPerson, getAuditSourceKind, getAuditTone } from '../audit-display'
import { groupByDay, type AuditEventSet } from '../audit-sets'
import { useAuditFormat } from '../useAuditFormat'
import AuditCategoryTile from './AuditCategoryTile.vue'
import AuditPersonLabel from './AuditPersonLabel.vue'

const props = defineProps<{ sets: AuditEventSet[] }>()
const emit = defineEmits<{ open: [set: AuditEventSet] }>()
const { t } = useI18n()
const format = useAuditFormat()

const days = computed(() => groupByDay(props.sets, (set) => set.day))

function toneClass(set: AuditEventSet) {
  const tones = set.items.map((entry) => getAuditTone(entry.action))
  if (tones.includes('danger')) return 'shadow-[inset_2px_0_0_var(--destructive)]'
  if (tones.includes('warning')) return 'shadow-[inset_2px_0_0_var(--pill-warning)]'
  return ''
}

function openSet(set: AuditEventSet) {
  emit('open', set)
}
</script>

<template>
  <div class="space-y-4 md:hidden">
    <section v-for="day in days" :key="day.day" :aria-label="format.dayTitle(day.day)">
      <h3 class="ms-0.5 mb-2 flex items-baseline gap-1.5 text-[13px] font-semibold text-foreground">
        {{ format.dayTitle(day.day) }}
        <span class="text-xs font-normal text-muted-foreground">{{ format.dayShort(day.day) }}</span>
      </h3>
      <ul class="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card shadow-xs">
        <li v-for="set in day.items" :key="set.id">
          <button
            type="button"
            class="grid w-full grid-cols-[2rem_minmax(0,1fr)] items-start gap-3 px-3 py-2.5 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            :class="toneClass(set)"
            @click="openSet(set)"
          >
            <AuditCategoryTile :category="getAuditCategory(set.first.action)" size="md" />
            <span class="flex min-w-0 flex-col">
              <span class="flex min-w-0 items-center gap-1.5">
                <span class="truncate text-sm font-medium text-foreground">{{ format.actionLabel(set.actions[0]!.action) }}</span>
                <span v-if="set.items.length > 1" class="shrink-0 rounded-xs bg-foreground/8 px-1 text-xs tabular-nums text-muted-foreground">
                  {{ formatNumber(set.items.length) }}
                </span>
                <span class="ms-auto shrink-0 ps-2 text-xs tabular-nums text-muted-foreground">{{ format.time(set.first.createdAt) }}</span>
              </span>
              <span v-if="format.targetOf(set.first)" class="flex min-w-0 items-center gap-1.5 text-sm">
                <span class="truncate" :class="format.targetOf(set.first)!.unnamed ? 'text-muted-foreground' : 'text-foreground'">{{
                  format.targetOf(set.first)!.name
                }}</span>
                <span
                  v-if="format.targetOf(set.first)!.gone === 'since'"
                  class="shrink-0 rounded-full px-1.5 text-[11px] leading-4 font-medium text-muted-foreground ring-1 ring-border ring-inset"
                  >{{ t('audit.target.sinceDeleted') }}</span
                >
              </span>
              <span class="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                <AuditPersonLabel :person="getAuditPerson(set.first)" size="xs" quiet :show-meta="false" class="min-w-0" />
                <span aria-hidden="true">·</span>
                <span class="shrink-0">{{ t(`audit.source.${getAuditSourceKind(set.first.ip, set.first.actorUsername)}`) }}</span>
              </span>
            </span>
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>
