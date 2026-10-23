<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { TriangleAlert } from '@lucide/vue'
import type { AuditSignInGroup } from '@bookorbit/types'
import { formatList } from '@/i18n/formatters'
import { getAuditPerson, getAuditSourceKind } from '../audit-display'
import { groupByDay } from '../audit-sets'
import { useAuditFormat } from '../useAuditFormat'
import AuditPersonLabel from './AuditPersonLabel.vue'
import AuditSourceLabel from './AuditSourceLabel.vue'

const props = defineProps<{ groups: AuditSignInGroup[] }>()
const { t } = useI18n()
const format = useAuditFormat()

const days = computed(() => groupByDay(props.groups, (group) => group.day))

function eventCount(groups: AuditSignInGroup[]) {
  return groups.reduce((sum, group) => sum + group.signIns + group.signOuts + group.failed, 0)
}

function personOf(group: AuditSignInGroup) {
  return getAuditPerson({ actorUsername: group.actorUsername, userId: group.userId, actorName: group.actorName })
}

function timeRange(group: AuditSignInGroup) {
  const first = format.time(group.firstAt)
  const last = format.time(group.lastAt)
  return first === last ? last : t('audit.signIns.range', { from: first, to: last })
}

function failedText(group: AuditSignInGroup) {
  return group.failedUsernames.length > 0
    ? t('audit.signIns.failedAs', { count: group.failed, names: formatList(group.failedUsernames) })
    : t('audit.signIns.failed', { count: group.failed })
}
</script>

<template>
  <div class="@container hidden overflow-hidden rounded-lg border border-border bg-card shadow-xs md:block">
    <table class="w-full table-fixed text-sm">
      <colgroup>
        <col class="w-[24%]" />
        <col />
        <col class="w-[22%]" />
        <col class="w-[12rem]" />
      </colgroup>
      <thead class="bg-foreground/3">
        <tr>
          <th scope="col" class="border-b border-border px-3 py-2.5 text-start text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            {{ t('audit.columns.person') }}
          </th>
          <th scope="col" class="border-b border-border px-3 py-2.5 text-start text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            {{ t('audit.columns.activity') }}
          </th>
          <th scope="col" class="border-b border-border px-3 py-2.5 text-start text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            {{ t('audit.columns.network') }}
          </th>
          <th scope="col" class="border-b border-border px-3 py-2.5 text-start text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            {{ t('audit.columns.time') }}
          </th>
        </tr>
      </thead>
      <tbody>
        <template v-for="(day, dayIndex) in days" :key="day.day">
          <tr>
            <td colspan="4" class="p-0">
              <div class="flex items-baseline gap-2 bg-foreground/[0.025] px-3 py-[7px]" :class="dayIndex > 0 ? 'border-t border-border' : ''">
                <span class="text-[12.5px] leading-[18px] font-semibold text-foreground">{{ format.dayTitle(day.day) }}</span>
                <span class="text-[12.5px] leading-[18px] text-muted-foreground">{{ format.dayDetail(day.day) }}</span>
                <span class="ms-auto text-xs tabular-nums text-muted-foreground">{{ t('audit.day.events', { count: eventCount(day.items) }) }}</span>
              </div>
            </td>
          </tr>
          <tr v-for="group in day.items" :key="`${group.day}-${group.actorUsername}-${group.ip}`">
            <td class="h-[45px] border-t border-border px-3 py-2" :class="group.failed > 0 ? 'shadow-[inset_2px_0_0_var(--pill-warning)]' : ''">
              <AuditPersonLabel :person="personOf(group)" />
            </td>
            <td class="border-t border-border px-3 py-2">
              <div class="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-muted-foreground">
                <span v-if="group.signIns > 0">{{ t('audit.signIns.signIns', { count: group.signIns }) }}</span>
                <span v-if="group.signIns > 0 && group.signOuts > 0" aria-hidden="true">·</span>
                <span v-if="group.signOuts > 0">{{ t('audit.signIns.signOuts', { count: group.signOuts }) }}</span>
                <span
                  v-if="group.failed > 0"
                  class="ms-1.5 inline-flex items-center gap-1 rounded-full border border-[var(--pill-warning)]/40 bg-[var(--pill-warning)]/10 px-2 py-px text-xs font-medium text-[var(--pill-warning)]"
                >
                  <TriangleAlert :size="12" aria-hidden="true" />
                  {{ failedText(group) }}
                </span>
              </div>
            </td>
            <td class="border-t border-border px-3 py-2">
              <AuditSourceLabel :kind="getAuditSourceKind(group.ip, group.actorUsername)" :ip="group.ip" />
            </td>
            <td class="border-t border-border px-3 py-2 whitespace-nowrap text-muted-foreground tabular-nums">{{ timeRange(group) }}</td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>

  <div class="space-y-4 md:hidden">
    <section v-for="day in days" :key="day.day" :aria-label="format.dayTitle(day.day)">
      <h3 class="ms-0.5 mb-2 flex items-baseline gap-1.5 text-[13px] font-semibold text-foreground">
        {{ format.dayTitle(day.day) }}
        <span class="text-xs font-normal text-muted-foreground">{{ format.dayShort(day.day) }}</span>
      </h3>
      <ul class="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card shadow-xs">
        <li
          v-for="group in day.items"
          :key="`${group.day}-${group.actorUsername}-${group.ip}`"
          class="flex flex-col gap-0.5 px-3 py-2.5"
          :class="group.failed > 0 ? 'shadow-[inset_2px_0_0_var(--pill-warning)]' : ''"
        >
          <div class="flex min-w-0 items-center gap-2">
            <AuditPersonLabel :person="personOf(group)" class="min-w-0" :show-meta="false" />
            <span class="ms-auto shrink-0 text-xs tabular-nums text-muted-foreground">{{ format.time(group.lastAt) }}</span>
          </div>
          <p class="text-sm text-foreground">
            <span v-if="group.signIns > 0">{{ t('audit.signIns.signIns', { count: group.signIns }) }}</span>
            <span v-if="group.failed > 0" class="font-medium text-[var(--pill-warning)]">
              <span v-if="group.signIns > 0" aria-hidden="true"> · </span>{{ failedText(group) }}
            </span>
          </p>
          <AuditSourceLabel :kind="getAuditSourceKind(group.ip, group.actorUsername)" :ip="group.ip" class="text-xs" />
        </li>
      </ul>
    </section>
  </div>
</template>
