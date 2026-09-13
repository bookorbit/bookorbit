<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Clock, FolderOpen, History, Pencil, Tags, Users } from '@lucide/vue'
import type { Library, LibraryScanHistoryEntry } from '@bookorbit/types'
import { FORMAT_LABELS } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate, formatList, formatPercent } from '@/i18n/formatters'
import { METADATA_LABELS } from '@/features/library/composables/useLibraryCreator'
import LibraryScanHistory from './LibraryScanHistory.vue'

const props = defineProps<{
  library: Library
  history: LibraryScanHistoryEntry[] | null
  accessCount: number | null
  loading: boolean
  failed: boolean
}>()

const emit = defineEmits<{ edit: [library: Library] }>()

const { t } = useI18n()

const organizationLabel = computed(() =>
  props.library.organizationMode === 'book_per_file' ? t('settings.admin.libraries.fileMode') : t('settings.admin.libraries.folderMode'),
)
const excludeLabel = computed(() =>
  props.library.excludePatterns.length === 0
    ? t('settings.admin.libraries.detail.none')
    : t('settings.admin.libraries.detail.patternCount', { count: props.library.excludePatterns.length }),
)
const precedenceLabel = computed(() =>
  props.library.metadataPrecedence.length === 0
    ? t('settings.admin.libraries.detail.none')
    : formatList(props.library.metadataPrecedence.map((key) => METADATA_LABELS[key] ?? key)),
)
const formatsLabel = computed(() =>
  props.library.allowedFormats.length === 0
    ? t('settings.admin.libraries.detail.allSupported')
    : formatList(props.library.allowedFormats.map((format) => FORMAT_LABELS[format] ?? format.toUpperCase())),
)
const accessLabel = computed(() => (props.accessCount === null ? '' : t('settings.admin.libraries.detail.peopleCount', { count: props.accessCount })))

function requestEdit() {
  emit('edit', props.library)
}
</script>

<template>
  <section
    class="border-t border-border bg-background/45 px-5 py-4"
    role="region"
    :aria-label="t('settings.admin.libraries.detailRegion', { name: library.name })"
  >
    <div class="grid gap-x-8 gap-y-6 lg:grid-cols-3">
      <section>
        <h4 class="mb-2.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <FolderOpen :size="12" aria-hidden="true" />
          {{ t('settings.admin.libraries.detail.foldersTitle') }}
          <Button
            variant="ghost"
            size="sm"
            type="button"
            class="ms-auto h-6 px-2 text-xs font-medium normal-case tracking-normal"
            @click="requestEdit"
          >
            <Pencil :size="12" aria-hidden="true" />
            {{ t('common.edit') }}
          </Button>
        </h4>
        <dl>
          <div
            v-for="(folder, index) in library.folders"
            :key="folder.id"
            class="flex items-center gap-3 border-t border-border py-1.5 first:border-t-0"
          >
            <dt class="shrink-0 text-[12.5px] text-muted-foreground">{{ t('settings.admin.libraries.detail.path', { index: index + 1 }) }}</dt>
            <dd class="ms-auto min-w-0 truncate font-mono text-[11px] text-foreground" dir="ltr" :title="folder.path">{{ folder.path }}</dd>
          </div>
          <div class="flex items-center gap-3 border-t border-border py-1.5">
            <dt class="shrink-0 text-[12.5px] text-muted-foreground">{{ t('settings.admin.libraries.detail.organization') }}</dt>
            <dd class="ms-auto text-[12.5px] font-medium text-foreground">{{ organizationLabel }}</dd>
          </div>
          <div class="flex items-center gap-3 border-t border-border py-1.5">
            <dt class="shrink-0 text-[12.5px] text-muted-foreground">{{ t('settings.admin.libraries.detail.excludePatterns') }}</dt>
            <dd class="ms-auto text-[12.5px] font-medium text-foreground">{{ excludeLabel }}</dd>
          </div>
        </dl>
      </section>

      <section>
        <h4 class="mb-2.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Tags :size="12" aria-hidden="true" />
          {{ t('settings.admin.libraries.detail.metadataTitle') }}
          <Button
            variant="ghost"
            size="sm"
            type="button"
            class="ms-auto h-6 px-2 text-xs font-medium normal-case tracking-normal"
            @click="requestEdit"
          >
            <Pencil :size="12" aria-hidden="true" />
            {{ t('common.edit') }}
          </Button>
        </h4>
        <dl>
          <div class="flex items-center gap-3 py-1.5">
            <dt class="shrink-0 text-[12.5px] text-muted-foreground">{{ t('settings.admin.libraries.detail.precedence') }}</dt>
            <dd class="ms-auto min-w-0 truncate text-[12.5px] font-medium text-foreground" :title="precedenceLabel">{{ precedenceLabel }}</dd>
          </div>
          <div class="flex items-center gap-3 border-t border-border py-1.5">
            <dt class="shrink-0 text-[12.5px] text-muted-foreground">{{ t('settings.admin.libraries.detail.allowedFormats') }}</dt>
            <dd class="ms-auto min-w-0 truncate text-[12.5px] font-medium text-foreground" :title="formatsLabel">{{ formatsLabel }}</dd>
          </div>
          <div class="flex items-center gap-3 border-t border-border py-1.5">
            <dt class="shrink-0 text-[12.5px] text-muted-foreground">{{ t('settings.admin.libraries.detail.countsAsStarted') }}</dt>
            <dd class="ms-auto text-[12.5px] font-medium tabular-nums text-foreground">{{ formatPercent(library.readingThreshold) }}</dd>
          </div>
          <div class="flex items-center gap-3 border-t border-border py-1.5">
            <dt class="shrink-0 text-[12.5px] text-muted-foreground">{{ t('settings.admin.libraries.detail.countsAsFinished') }}</dt>
            <dd class="ms-auto text-[12.5px] font-medium tabular-nums text-foreground">
              {{ formatPercent(library.markAsFinishedPercentComplete / 100) }}
            </dd>
          </div>
        </dl>
      </section>

      <section>
        <h4 class="mb-2.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Users :size="12" aria-hidden="true" />
          {{ t('settings.admin.libraries.detail.accessTitle') }}
        </h4>
        <dl>
          <div class="flex items-center gap-3 py-1.5">
            <dt class="shrink-0 text-[12.5px] text-muted-foreground">{{ t('settings.admin.libraries.detail.peopleWithAccess') }}</dt>
            <dd class="ms-auto text-[12.5px] font-medium text-foreground">
              <Skeleton v-if="loading" class="h-4 w-16" />
              <span v-else>{{ accessLabel || '—' }}</span>
            </dd>
          </div>
          <div class="flex items-center gap-3 border-t border-border py-1.5">
            <dt class="shrink-0 text-[12.5px] text-muted-foreground">{{ t('settings.admin.libraries.detail.added') }}</dt>
            <dd class="ms-auto text-[12.5px] font-medium text-foreground">
              {{ formatDate(new Date(library.createdAt), { year: 'numeric', month: 'short', day: 'numeric' }) }}
            </dd>
          </div>
          <div class="flex items-center gap-3 border-t border-border py-1.5">
            <dt class="shrink-0 text-[12.5px] text-muted-foreground">{{ t('settings.admin.libraries.detail.coverShape') }}</dt>
            <dd class="ms-auto text-[12.5px] font-medium text-foreground">
              {{ t(`settings.admin.libraries.detail.coverShapeValue.${library.coverAspectRatio === '1/1' ? 'square' : 'portrait'}`) }}
            </dd>
          </div>
        </dl>
      </section>
    </div>

    <section class="mt-5">
      <h4 class="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <History :size="12" aria-hidden="true" />
        {{ t('settings.admin.libraries.detail.historyTitle') }}
      </h4>
      <div v-if="loading" class="space-y-1.5" aria-hidden="true">
        <Skeleton v-for="index in 3" :key="index" class="h-6 w-full" />
      </div>
      <p v-else-if="failed" role="alert" class="text-[12.5px] text-destructive">{{ t('settings.admin.libraries.detail.historyFailed') }}</p>
      <p v-else-if="!history || history.length === 0" class="flex items-center gap-2 py-1 text-[12.5px] text-muted-foreground">
        <Clock :size="13" aria-hidden="true" />
        {{ t('settings.admin.libraries.detail.historyEmpty') }}
      </p>
      <LibraryScanHistory v-else :entries="history" />
    </section>
  </section>
</template>
