<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AuditLogEntry } from '@bookorbit/types'
import { formatDateTime } from '@/i18n/formatters'
import AuditCategoryBadge from './AuditCategoryBadge.vue'
import { getAuditActionLabelKey } from './audit-actions'
import { getAuditCategory } from './audit-display'
import { getBookDeletionAuditMeta } from './audit-meta'
import { getAuditResourceLabelKey } from './audit-resources'

const props = defineProps<{ entry: AuditLogEntry }>()
const { t } = useI18n()

const deletionMeta = computed(() => getBookDeletionAuditMeta(props.entry))
const category = computed(() => getAuditCategory(props.entry.action))
</script>

<template>
  <div
    role="region"
    :aria-label="t('audit.entryDetailsLabel', { id: entry.id })"
    class="space-y-3 rounded-md border border-border bg-background px-3 py-3 text-xs text-muted-foreground"
  >
    <dl class="grid gap-x-6 gap-y-2 sm:grid-cols-2 xl:grid-cols-4">
      <div>
        <dt class="font-medium text-foreground">{{ t('audit.detailEventId') }}</dt>
        <dd class="mt-0.5 font-mono">{{ entry.id }}</dd>
      </div>
      <div>
        <dt class="font-medium text-foreground">{{ t('audit.detailOccurredAt') }}</dt>
        <dd class="mt-0.5">{{ formatDateTime(new Date(entry.createdAt)) }}</dd>
      </div>
      <div>
        <dt class="font-medium text-foreground">{{ t('audit.detailActor') }}</dt>
        <dd class="mt-0.5">
          {{ entry.actorUsername }}
          <span v-if="entry.userId !== null">({{ t('audit.userId', { id: entry.userId }) }})</span>
        </dd>
      </div>
      <div>
        <dt class="font-medium text-foreground">{{ t('audit.detailCategory') }}</dt>
        <dd class="mt-0.5"><AuditCategoryBadge :category="category" /></dd>
      </div>
      <div>
        <dt class="font-medium text-foreground">{{ t('audit.detailEventTypeLabel') }}</dt>
        <dd class="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-1.5">
          <span class="font-medium text-foreground">{{ t(getAuditActionLabelKey(entry.action)) }}</span>
          <code class="text-[11px] text-muted-foreground">{{ entry.action }}</code>
        </dd>
      </div>
      <div>
        <dt class="font-medium text-foreground">{{ t('audit.detailIpLabel') }}</dt>
        <dd class="mt-0.5 font-mono">{{ entry.ip ?? '-' }}</dd>
      </div>
      <div v-if="entry.resource">
        <dt class="font-medium text-foreground">{{ t('audit.detailTargetTypeLabel') }}</dt>
        <dd class="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-1.5">
          <span class="font-medium text-foreground">{{ t(getAuditResourceLabelKey(entry.resource)) }}</span>
          <code class="text-[11px] text-muted-foreground">{{ entry.resource }}</code>
        </dd>
      </div>
      <div v-if="entry.resourceId !== null">
        <dt class="font-medium text-foreground">{{ t('audit.detailTargetIdLabel') }}</dt>
        <dd class="mt-0.5 font-mono">{{ entry.resourceId }}</dd>
      </div>
    </dl>

    <div v-if="deletionMeta && deletionMeta.books.length > 0" class="border-t border-border pt-3">
      <p class="font-medium text-foreground">{{ t('audit.deletedBooks') }}</p>
      <ul class="mt-1 space-y-1">
        <li v-for="book in deletionMeta.books" :key="book.id">
          {{ t('audit.deletedBookDetail', { id: book.id, title: book.title ?? t('audit.untitledBook') }) }}
        </li>
      </ul>
      <p v-if="deletionMeta.omitted > 0" class="mt-1">
        {{ t('audit.deletedBooksOmitted', { count: deletionMeta.omitted }) }}
      </p>
    </div>
  </div>
</template>
