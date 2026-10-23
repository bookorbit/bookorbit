<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronRight } from '@lucide/vue'
import { formatNumber } from '@/i18n/formatters'
import { getAuditCategory, getAuditPerson, getAuditSourceKind, getAuditTone } from '../audit-display'
import { groupByDay, type AuditEventSet } from '../audit-sets'
import { useAuditFormat } from '../useAuditFormat'
import AuditCategoryTile from './AuditCategoryTile.vue'
import AuditPersonLabel from './AuditPersonLabel.vue'
import AuditSourceLabel from './AuditSourceLabel.vue'
import AuditTargetLabel from './AuditTargetLabel.vue'

const props = defineProps<{ sets: AuditEventSet[]; openId: number | null; unit: 'changes' | 'events' }>()
const emit = defineEmits<{ open: [set: AuditEventSet] }>()
const { t } = useI18n()
const format = useAuditFormat()

const days = computed(() => groupByDay(props.sets, (set) => set.day))

function eventCount(sets: AuditEventSet[]) {
  return sets.reduce((sum, set) => sum + set.items.length, 0)
}

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
  <div class="@container hidden overflow-hidden rounded-lg border border-border bg-card shadow-xs md:block">
    <table class="w-full table-fixed text-sm">
      <colgroup>
        <col class="w-[6.5rem] @max-[77rem]:w-24" />
        <col class="w-[13rem] @max-[77rem]:w-[12.25rem]" />
        <col class="w-[31%] @max-[77rem]:w-[30%]" />
        <col />
        <col class="w-[13.75rem] @max-[77rem]:w-[9.25rem]" />
        <col class="w-10" />
      </colgroup>
      <thead class="bg-foreground/3">
        <tr>
          <th scope="col" class="border-b border-border px-3 py-2.5 text-start text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            {{ t('audit.columns.time') }}
          </th>
          <th scope="col" class="border-b border-border px-3 py-2.5 text-start text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            {{ t('audit.columns.person') }}
          </th>
          <th scope="col" class="border-b border-border px-3 py-2.5 text-start text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            {{ t('audit.columns.event') }}
          </th>
          <th scope="col" class="border-b border-border px-3 py-2.5 text-start text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            {{ t('audit.columns.target') }}
          </th>
          <th scope="col" class="border-b border-border px-3 py-2.5 text-start text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            {{ t('audit.columns.source') }}
          </th>
          <th scope="col" class="border-b border-border">
            <span class="sr-only">{{ t('audit.columns.open') }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <template v-for="(day, dayIndex) in days" :key="day.day">
          <tr>
            <td colspan="6" class="p-0">
              <div class="flex items-baseline gap-2 bg-foreground/[0.025] px-3 py-[7px]" :class="dayIndex > 0 ? 'border-t border-border' : ''">
                <span class="text-[12.5px] leading-[18px] font-semibold text-foreground">{{ format.dayTitle(day.day) }}</span>
                <span class="text-[12.5px] leading-[18px] text-muted-foreground">{{ format.dayDetail(day.day) }}</span>
                <span class="ms-auto text-xs tabular-nums text-muted-foreground">{{ t(`audit.day.${unit}`, { count: eventCount(day.items) }) }}</span>
              </div>
            </td>
          </tr>
          <tr
            v-for="set in day.items"
            :key="set.id"
            class="group relative transition-colors hover:bg-foreground/4"
            :class="openId === set.id ? 'bg-primary/7 hover:bg-primary/7' : ''"
          >
            <td class="h-[45px] border-t border-border px-3 py-2 whitespace-nowrap text-muted-foreground tabular-nums" :class="toneClass(set)">
              {{ format.time(set.first.createdAt) }}
            </td>
            <td class="border-t border-border px-3 py-2">
              <AuditPersonLabel :person="getAuditPerson(set.first)" :show-meta="false" />
            </td>
            <td class="border-t border-border px-3 py-2">
              <div class="flex min-w-0 items-center gap-2.5">
                <AuditCategoryTile :category="getAuditCategory(set.first.action)" class="-my-0.5" />
                <button
                  type="button"
                  class="min-w-0 truncate text-start font-medium text-foreground after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded-sm focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
                  :aria-label="t('audit.openEvent', { event: format.actionLabel(set.actions[0]!.action) })"
                  :aria-expanded="openId === set.id"
                  @click="openSet(set)"
                >
                  {{ format.actionLabel(set.actions[0]!.action) }}
                </button>
                <span v-if="set.actions[0]!.count > 1" class="shrink-0 rounded-xs bg-foreground/8 px-1 text-xs tabular-nums text-muted-foreground">
                  {{ formatNumber(set.actions[0]!.count) }}
                </span>
                <span
                  v-for="other in set.actions.slice(1)"
                  :key="other.action"
                  class="inline-flex min-w-0 shrink-[4] items-center gap-1 overflow-hidden text-[13px] whitespace-nowrap text-muted-foreground before:me-0.5 before:content-['·']"
                >
                  {{ format.actionLabel(other.action) }}
                  <span v-if="other.count > 1" class="rounded-xs bg-foreground/8 px-1 text-xs tabular-nums">{{ formatNumber(other.count) }}</span>
                </span>
              </div>
            </td>
            <td class="border-t border-border px-3 py-2">
              <div class="truncate"><AuditTargetLabel :target="format.targetOf(set.first)" /></div>
            </td>
            <td class="border-t border-border px-3 py-2">
              <AuditSourceLabel :kind="getAuditSourceKind(set.first.ip, set.first.actorUsername)" :ip="set.first.ip" />
            </td>
            <td class="border-t border-border pe-3.5 text-end text-muted-foreground group-hover:text-foreground">
              <ChevronRight :size="16" class="inline rtl:rotate-180" aria-hidden="true" />
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>
